const { SMTPServer } = require("smtp-server");
const { MailParser } = require('mailparser');
const ParseEmailAddress = require("email-addresses");

const ROOM_ID = "!IfhHtxETxbbvbBgfol:localhost"; // TODO: Join rooms based on alias and get the roomID


module.exports.startSMTP = new SMTPServer({
    secure: false,
    logger: false,
    disabledCommands: ['AUTH', 'STARTTLS'],
    authOptional: true,

    onData: function (stream, session, callback) {
        let subject, text;
        let mailparser = new MailParser();
        let fromAdd = ParseEmailAddress.parseOneAddress(session.envelope.mailFrom.address);
        // console.log(session.envelope.mailFrom.address)

        mailparser.on('headers', headers => {
            subject = headers.get('subject');
        });

        mailparser.on('data', data => {
            if (data.type === 'text') {
                text = data.text;
            }
        });

        mailparser.on('end', () => {
            console.log(text);
            const intent = bridge.getIntent("@_email_" + fromAdd.local + "_" + fromAdd.domain + ":localhost");
            intent.sendText(ROOM_ID, text);
        });

        stream.pipe(mailparser);
        stream.on('end', callback);
    }
});

