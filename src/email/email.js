const { SMTPServer } = require("smtp-server");
const { MailParser } = require('mailparser');
const ParseEmailAddress = require("email-addresses");
const { Logging } = require('../log');

const log = Logging.get("email");

const roomAlias = function(rcptTo, mxDomain) {
    let localpartRcptTo;
    for (let i = 0; i < rcptTo.length; i++) {
        localpartRcptTo = ParseEmailAddress.parseOneAddress(rcptTo[i].address).local;
        if ( localpartRcptTo.endsWith(mxDomain)) {
            log.info("Message destination address:", localpartRcptTo);
            break;
        }
    }
    return getUserIdorAlias(localpartRcptTo);
};
const splitAt = index => x => [x.slice(0, index), x.slice(index+1)];

const getUserIdorAlias = function(localPart) {

    // Received room+<roomalias>_hs
    if (localPart.startsWith('room+')) {
        log.info("Message destination is a room");
        let alias = localPart.substring(localPart.indexOf('+')+1);
        if (alias.lastIndexOf('_') >= 1) {
            return splitAt(alias.lastIndexOf('_'))(alias).unshift("room");
        }
      return null;
    }

    // Received user+<username>_<hs>
    else if (localPart.startsWith('user+')) {
        log.info("Message destination is a user");
        let uname = localPart.substring(localPart.indexOf('+')+1);
        if (uname.lastIndexOf('_') >= 1) {
            return splitAt(uname.lastIndexOf('_'))(uname).unshift("user");
        }
      return null;
    }

    log.warn("Destination is not valid");
    return null;
};

exports.startSMTP = function (config) {
    const SMTP = new SMTPServer({
        secure: false,
        logger: false,
        disabledCommands: ['AUTH', 'STARTTLS'],
        authOptional: true,

        onData: function (stream, session, callback) {
            let subject, text;
            const mailparser = new MailParser();
            const fromAdd = ParseEmailAddress.parseOneAddress(session.envelope.mailFrom.address);
            let receivedAddress = roomAlias(session.envelope.rcptTo, config.bridge.domain);
            const alias = "";
            if (!receivedAddress) {
                return;
            }
            else if (receivedAddress[0] === "room") {
                alias = `#${receivedAddress[1]}:${receivedAddress[2]}`;
            }
            else if (receivedAddress[0] === "user") {
                // TODO: send message to user
                return;
            }
            mailparser.on('headers', headers => {
                subject = headers.get('subject');
            });

            mailparser.on('data', data => {
                if (data.type === 'text') {
                    text = data.text;
                }
            });

            mailparser.on('end', () => {
                if (!text.trim().length) {
                    // text only contains whitespace (ie. spaces, tabs or line breaks)
                    log.warn("Inbound email contains whitespace only");
                    return;
                }
                log.info("Inbound email contents: "+ text.substring(0, 10) + "... ");

                // The complete event MUST NOT be larger than 65535 bytes.
                // Using 63k as the maximum text size.
                let message = Buffer.from(text, "utf-8");

                const intent = bridge.getIntent(`@_email_${fromAdd.local }_${fromAdd.domain}:${config.bridge.domain}`);

                if (message.byteLength > 63000) {
                    // split text to under 63k and send as seperate events.
                    log.info("Mail contents greater than 63k");
                    for (let i = 0; i<message.byteLength; i = i + 63000) {
                        intent.sendText(intent.resolveRoom(alias), message.toString("utf-8", i, i + 62999));
                    }
                }
                else {
                    // send message as a single event.
                    intent.sendText(ROOM_ID, text);
                }
            });

            stream.pipe(mailparser);
            stream.on('end', callback);
        }
    });
    SMTP.listen(config.bridge.mailPort);
};

