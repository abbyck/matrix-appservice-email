const { SMTPServer } = require("smtp-server");
const { MailParser } = require('mailparser');
const ParseEmailAddress = require("email-addresses");
const { Logging } = require('../log');


const log = Logging.get("email");

const ROOM_ID = "!IfhHtxETxbbvbBgfol:localhost"; // TODO: Join rooms based on alias and get the roomID

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
                log.info("here the configs", config);
                // The complete event MUST NOT be larger than 65535 bytes.
                // Using 63k as the maximum text size.
                let message = Buffer.from(text, "utf-8");
                const intent = bridge.getIntent(`@_email_${fromAdd.local }_${fromAdd.domain}:${config.bridge.domain}`);
                if (message.byteLength > 63000) {
                    // split text to under 63k and send as seperate events.
                    log.info("Mail contents greater than 63k")
                    for (let i = 0; i<message.byteLength; i = i + 63000) {
                        intent.sendText(ROOM_ID, message.toString("utf-8", i, i + 62999));
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
