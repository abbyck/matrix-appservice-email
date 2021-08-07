const { createConnection } = require('net');
const { Resolver } = require('dns').promises;
const { DKIMSign } = require('dkim-signer');
const { connect, createSecureContext } = require('tls');
const MailComposer = require("nodemailer/lib/mail-composer");
const ParseEmailAddress = require("email-addresses");

const { Logging } = require('../log');
const resolver = new Resolver();
const log = Logging.get("outbound");
const CRLF = '\r\n';

module.exports = function (options) {
    options = options || {};
    const dkimEnabled = options.dkimEnabled || false;
    const dkimPrivateKey = (options.dkim || {}).privateKey;
    const dkimKeySelector = (options.dkim || {}).keySelector || 'dkim';
    const smtpPort = options.smtpPort || 25;
    const smtpHost = options.smtpHost;
    const rejectUnauthorized = options.rejectUnauthorized;
    const startTLS = options.startTLS || false;
    const tls = options.tls || {};

    // group recipients by domain(to limit the number of connections per 'To' domain).
    function groupRecipients(recipients) {
        const groups = {};
        for (const recipient of recipients) {
            const host = ParseEmailAddress.parseOneAddress(recipient).domain;
            (groups[host] || (groups[host] = [])).push(recipient);
        }
        return groups;
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
     * Resolve MX records by domain.
     * @param domain
     * @returns {Promise<MxRecord[]|*[]>}
     */
    async function resolveMX(domain) {
        let resolvedMX = [];
        if (smtpHost !== '') {
            resolvedMX.push({ exchange: smtpHost });
            return resolvedMX;
        }
        try {
            resolvedMX = await resolver.resolveMx(domain);
            resolvedMX.sort(function (a, b) { return a.priority - b.priority; });
            return resolvedMX;
        }
        catch (ex) {
            throw Error(`Failed to resolve MX for ${domain}: ${ex}`);
        }
    }

    async function sendToSMTP(domain, srcHost, from, recipients, body) {
        const resolvedMX = await resolveMX(domain);
        log.info("Resolved mx list:", resolvedMX);
        let sock;
        function tryConnect(i) {
            if (i >= resolvedMX.length) {
                throw Error(`Could not connect to any SMTP server for ${domain}`);
            }

            sock = createConnection(smtpPort, resolvedMX[i].exchange);

            sock.on('error', function (err) {
                log.error('Error on connectMx for: ', resolvedMX[i], err);
                tryConnect(++i);
            });

            sock.on('connect', function () {
                log.debug('MX connection created: ', resolvedMX[i].exchange);
                sock.removeAllListeners('error');
                return sock;
            });
        }
        tryConnect(0);

        function w(s) {
            log.debug(`SEND ${domain}> ${s}`);
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
            throw Error(`Failed to connect to ${domain}: ${err}`);
        });

        let data = '';
        let step = 0;
        let loginStep = 0;
        const queue = [];
        // const login = [];
        let parts;
        let cmd;
        let upgraded = false;
        let isUpgradeInProgress = false;

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
                    //220   on server ready
                    if (isUpgradeInProgress === true) {
                        sock.removeAllListeners('data');
                        let original = sock;
                        original.pause();
                        let opts = {
                            socket: sock,
                            host: sock._host,
                            rejectUnauthorized,
                        };
                        if (startTLS) {
                            opts.secureContext = createSecureContext({ cert: tls.cert, key: tls.key });
                        }
                        sock = connect(
                            opts,
                            () => {
                                sock.on('data', function (chunk) {
                                    data += chunk;
                                    parts = data.split(CRLF);
                                    const partsLength = parts.length - 1;
                                    for (let i = 0, len = partsLength; i < len; i++) {
                                        onLine(parts[i]);
                                    }
                                    data = parts[parts.length - 1];
                                });
                                sock.removeAllListeners('close');
                                sock.removeAllListeners('end');
                            }
                        );
                        sock.on('error', function (err) {
                            log.warn("Could not upgrade to TLS:", err, "Falling back to plaintext");
                        });
                        // Resume plaintext connection
                        original.resume();
                        upgraded = true;
                        w("EHLO " + srcHost);
                        break;
                    }
                    else {
                        // check for ESMTP/ignore-case
                        if (/\besmtp\b/i.test(msg)) {
                            // TODO: determine AUTH type; auth login, auth crm-md5, auth plain
                            cmd = 'EHLO';
                        }
                        else {
                            upgraded = true;
                            cmd = 'HELO';
                        }
                        w(`${cmd} ${srcHost}`);
                        break;
                    }
                case 221: // BYE
                    sock.end();
                    log.info("message sent successfully", msg);
                    break;
                case 235: // Verify OK
                case 250: // Operation OK
                    if (upgraded != true) {
                        // check for STARTTLS/ignore-case
                        if (/\bSTARTTLS\b/i.test(msg) && options.starttls) {
                            log.debug("Server supports STARTTLS, continuing");
                            w('STARTTLS');
                            isUpgradeInProgress = true;
                            break;
                        }
                        else {
                            upgraded = true;
                            log.debug("No STARTTLS support or ignored, continuing");
                        }
                    }
                    w(queue[step]);
                    step++;
                    break;

                case 251: // forward
                    if (step === queue.length - 1) {
                        log.info('OK:', code, msg);
                        return;
                    }
                    w(queue[step]);
                    step++;
                    break;

                case 354:
                    // Send message, inform end by `<CR><LF>.<CR><LF>`
                    log.info('Sending mail body', body);
                    w(body);
                    w('');
                    w('.');
                    break;

                case 334: // Send login details [for relay]
                    // TODO: support login.
                    w(login[loginStep]);
                    loginStep++;
                    break;

                default:
                    if (code >= 400) {
                        log.error('SMTP server responds with error code', code);
                        sock.end();
                        throw Error(`SMTP server responded with code: ${code} + ${msg}`);
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
                let lineNumber = parseInt(line.substr(0, 3));
                response(lineNumber, msg);
                msg = '';
            }
        }
    }

    /**
     * Send Mail directly
     * `mail` object attribute reference: https://nodemailer.com/extras/mailcomposer/#e-mail-message-fields
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
     */
    async function sendmail(mail) {
        const mailMe = new MailComposer(mail);
        let recipients = [];
        if (mail.to) {
            recipients = recipients.concat(getAddresses(mail.to));
        }

        if (mail.cc) {
            recipients = recipients.concat(getAddresses(mail.cc));
        }

        if (mail.bcc) {
            recipients = recipients.concat(getAddresses(mail.bcc));
        }

        const groups = groupRecipients(recipients);
        const from = ParseEmailAddress.parseOneAddress(mail.from).address;
        const srcHost = ParseEmailAddress.parseOneAddress(from).domain;

        await mailMe.compile().build(async function (err, message) {
            if (err) {
                throw Error(`Error on building the message: ${err}`);
            }
            if (dkimEnabled) {
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
                try {
                    await sendToSMTP(domain, srcHost, from, groups[domain], message);
                }
                catch (ex) {
                    log.error(`Could not send email to ${domain}: ${ex}`);
                }
            }
        });
    }
    return sendmail;
};
