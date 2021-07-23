const { createConnection } = require('net');
const { resolveMx } = require('dns');
const { DKIMSign } = require('dkim-signer');
const MailComposer = require("nodemailer/lib/mail-composer");
const ParseEmailAddress = require("email-addresses");
const { Logging } = require('../log');

const log = Logging.get("outbound");
const CRLF = '\r\n';

module.exports = function (options) {
    options = options || {};

    const dkimPrivateKey = (options.dkim || {}).privateKey;
    const dkimKeySelector = (options.dkim || {}).keySelector || 'dkim';
    const devPort = options.devPort || -1;
    const devHost = options.devHost || 'localhost';
    const smtpPort = options.smtpPort || 25;
    const smtpHost = options.smtpHost || -1;

    function groupRecipients(recipients) {
        const groups = {};
        for (const recipient of recipients) {
            const host = ParseEmailAddress.parseOneAddress(recipient).domain;
            (groups[host] || (groups[host] = [])).push(recipient);
        }
        return groups;
    }

    /**
     * connect to domain by MX record
     */
    function connectMx(domain, callback) {
        if (devPort === -1) { // not in development mode -> search the MX
            // eslint-disable-next-line consistent-return
            resolveMx(domain, function (err, data) {
                if (err) {
                    return callback(err);
                }

                data.sort(function (a, b) { return a.priority > b.priority; });
                log.debug('MX resolved: ', data);

                if (!data || data.length === 0) {
                    return callback(new Error('can not resolve Mx of <' + domain + '>'));
                }
                if (smtpHost !== -1) {
                    data.push({ exchange: smtpHost });
                }
                // eslint-disable-next-line consistent-return
                function tryConnect(i) {
                    if (i >= data.length) {
                        return callback(new Error('can not connect to any SMTP server'));
                    }

                    const sock = createConnection(smtpPort, data[i].exchange);

                    sock.on('error', function (err) {
                        log.error('Error on connectMx for: ', data[i], err);
                        tryConnect(++i);
                    });

                    sock.on('connect', function () {
                        log.debug('MX connection created: ', data[i].exchange);
                        sock.removeAllListeners('error');
                        callback(null, sock);
                    });
                }

                tryConnect(0);
            });
        }
        else { // development mode -> connect to the specified devPort on devHost
            const sock = createConnection(devPort, devHost);

            sock.on('error', function (err) {
                callback(new Error('Error on connectMx (development) for "' + devHost + ':' + devPort + '": ' + err));
            });

            sock.on('connect', function () {
                log.info('MX (development) connection created: ' + devHost + ':' + devPort);
                sock.removeAllListeners('error');
                callback(null, sock);
            });
        }
    }

    function sendToSMTP(domain, srcHost, from, recipients, body, cb) {
        const callback = (typeof cb === 'function') ? cb : function () { };
        // eslint-disable-next-line consistent-return
        connectMx(domain, function (err, sock) {
            if (err) {
                log.error('error on connectMx', err.stack);
                return callback(err);
            }

            function w(s) {
                log.info('SEND ' + domain + '>' + s);
                sock.write(s + CRLF);
            }

            sock.setEncoding('utf8');

            sock.on('data', function (chunk) {
                data += chunk;
                parts = data.split(CRLF);
                const partsLength = parts.length - 1;
                for (let i = 0, len = partsLength; i < len; i++) {
                    onLine(parts[i]);
                }
                data = parts[parts.length - 1];
            });

            sock.on('error', function (err) {
                log.error('fail to connect ' + domain);
                callback(err);
            });

            let data = '';
            let step = 0;
            let loginStep = 0;
            const queue = [];
            // const login = [];
            let parts;
            let cmd;

            /* SMTP relay [next hop]
             if(mail.user && mail.pass){
               queue.push('AUTH LOGIN');
               login.push(new Buffer(mail.user).toString("base64"));
               login.push(new Buffer(mail.pass).toString("base64"));
             }
             */

            queue.push('MAIL FROM:<' + from + '>');
            const recipientsLength = recipients.length;
            for (let i = 0; i < recipientsLength; i++) {
                queue.push('RCPT TO:<' + recipients[i] + '>');
            }
            queue.push('DATA');
            queue.push('QUIT');
            queue.push('');

            function response(code, msg) {
                switch (code) {
                    case 220:
                        //220 on server ready
                        // check for ESMTP/ignore-case
                        if (/\besmtp\b/i.test(msg)) {
                            /* TODO: determine AUTH type; auth login, auth crm-md5, auth plain
                            /* for Relaying.
                             */
                            cmd = 'EHLO';
                        }
                        else {
                            cmd = 'HELO';
                        }
                        w(cmd + ' ' + srcHost);
                        break;

                    case 221: // BYE
                    case 235: // verify OK
                    case 250: // operation OK
                    case 251: // forward
                        if (step === queue.length - 1) {
                            log.info('OK:', code, msg);
                            callback(null, msg);
                        }
                        w(queue[step]);
                        step++;
                        break;

                    case 354:
                        // Send message, inform end by CRLF . CRLF
                        log.info('sending mail', body);
                        w(body);
                        w('');
                        w('.');
                        break;

                    case 334: // Send login details [for relay]
                        w(login[loginStep]);
                        loginStep++;
                        break;

                    default:
                        if (code >= 400) {
                            log.warn('SMTP responds with error code', code);
                            callback(new Error('SMTP code:' + code + ' msg:' + msg));
                            sock.end();
                        }
                }
            }

            let msg = '';

            function onLine(line) {
                log.debug('RECV ' + domain + '>' + line);

                msg += (line + CRLF);

                if (line[3] === ' ') {
                    // 250-information dash is not complete.
                    // 250 OK. space is complete.
                    let lineNumber = parseInt(line);
                    response(lineNumber, msg);
                    msg = '';
                }
            }
        });
    }


    function getAddresses(addresses) {
        const results = [];
        if (!Array.isArray(addresses)) {
            addresses = addresses.split(',');
        }

        const addressesLength = addresses.length;
        for (let i = 0; i < addressesLength; i++) {
            results.push(ParseEmailAddress.parseOneAddress(addresses[i]).address);
        }
        return results;
    }

    /**
     * sendmail directly
     * mail obj attr reference: https://nodemailer.com/extras/mailcomposer/#e-mail-message-fields
     * @param mail {object}
     *             from
     *             to
     *             cc
     *             bcc
     *             replyTo
     *             returnTo
     *             subject
     *             type         default 'text/plain', 'text/html'
     *             charset      default 'utf-8'
     *             encoding     default 'base64'
     *             id           default timestamp+from
     *             headers      object
     *             content
     *             attachments
     *               [{
     *                 type
     *                 filename
     *                 content
     *               }].
     *
     * @param callback function(err, domain).
     *
     */
    function sendmail(mail, callback) {
        const mailMe = new MailComposer(mail);
        let recipients = [];
        let groups;
        let srcHost;
        if (mail.to) {
            recipients = recipients.concat(getAddresses(mail.to));
        }

        if (mail.cc) {
            recipients = recipients.concat(getAddresses(mail.cc));
        }

        if (mail.bcc) {
            recipients = recipients.concat(getAddresses(mail.bcc));
        }

        groups = groupRecipients(recipients);

        const from = ParseEmailAddress.parseOneAddress(mail.from).address;
        srcHost = ParseEmailAddress.parseOneAddress(from).domain;

        mailMe.compile().build(function (err, message) {
            if (err) {
                log.error('Error on creating message : ', err);
                callback(err, null);
                return;
            }
            if (dkimPrivateKey) {
                // eslint-disable-next-line new-cap
                const signature = DKIMSign(message, {
                    privateKey: dkimPrivateKey,
                    keySelector: dkimKeySelector,
                    domainName: srcHost
                });
                message = signature + CRLF + message;
            }
            // eslint-disable-next-line guard-for-in
            for (let domain in groups) {
                sendToSMTP(domain, srcHost, from, groups[domain], message, callback);
            }
        });
    }
    return sendmail;
};