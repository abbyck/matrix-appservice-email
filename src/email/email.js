const { SMTPServer } = require("smtp-server");
const { MailParser } = require('mailparser');
const ParseEmailAddress = require("email-addresses");
const { Logging } = require('../log');

const log = Logging.get("email");


/***
 * The complete event MUST NOT be larger than 65535 bytes.
 * https://spec.matrix.org/unstable/client-server-api/#size-limits
 * Using 63k as the maximum text size.
 * @type {number}
 */
const MAX_MATRIX_MESSAGE_SIZE = 63000;


/***
 * Returns an array containing Room Alias and HomeServer.
 * @param {string} rcptTo   The `To address` from the received email.
 * @param {string} mxDomain The domain name in which the SMTP server is listening.
 * @returns {Error|[string, string]} An array containing the alias or userID and homeserver.
 */
const getRoomAliasFromEmailTo = function(rcptTo, mxDomain) {
    let localPartRcptTo;
    for (let i = 0; i < rcptTo.length; i++) {
        localPartRcptTo = ParseEmailAddress.parseOneAddress(rcptTo[i].address).local;
        if (localPartRcptTo.endsWith(mxDomain)) {
            log.info("Message destination address:", localPartRcptTo);
            return getUserIdOrAlias(localPartRcptTo);
        }
    }
    return new Error("Could not determine alias from address");
};


/***
 * Split a string at given index into an array containing the two parts.
 * @param index string index at which the string has to be split.
 * @returns {function(string): [string, string]}
 */
const splitAt = index => x => [x.slice(0, index), x.slice(index+1)];


/***
 * Get userID or Room alias based on the localPart of the email address.
 * @param   {string}    localPart
 * @returns {Error|[string, string]}
 */
const getUserIdOrAlias = function(localPart) {
    // Received room+<roomalias>_hs
    if (localPart.startsWith('room+')) {
        log.info("Message destination is a room");
        let alias = localPart.substring(localPart.indexOf('+')+1);
        if (alias.lastIndexOf('_') >= 1) {
            let res = splitAt(alias.lastIndexOf('_'))(alias);
            res.unshift("room");
            return res;
        }
    }
    // Received user+<username>_<hs>
    else if (localPart.startsWith('user+')) {
        log.info("Message destination is a user");
        let uname = localPart.substring(localPart.indexOf('+')+1);
        if (uname.lastIndexOf('_') >= 1) {
            let res = splitAt(uname.lastIndexOf('_'))(uname);
            res.unshift("user");
            return res;
        }
    }
    return new Error("Can not resolve UserID or Alias from the received localPart");
};


/***
 * Send the inbound mail's contents to the corresponding rooms.
 * @param {string}  text    The text content of the email.
 * @param {ParsedMailbox}  fromAdd Email address of the sender.
 * @param {string}  alias   Destination room alias.
 * @param {object}  config  Bridge configurations.
 * @returns {Promise<void>}
 */
async function handleMail(text, fromAdd, alias, config) {
    if (!text.trim().length) {
        // text only contains whitespace (ie. spaces, tabs or line breaks)
        log.warn("Inbound email contains whitespace only");
        return;
    }

    log.info("Inbound email contents: "+ text.substring(0, 10) + "... ");

    const intent = bridge.getIntent(`@_email_${fromAdd.local }_${fromAdd.domain}:${config.bridge.domain}`);
    let message = Buffer.from(text, "utf-8");
    let roomID = await intent.resolveRoom(alias);

    if (!roomID.startsWith("!")) {
        throw Error("Could not resolve roomID from given alias");
    }

    if (message.byteLength > MAX_MATRIX_MESSAGE_SIZE) {
        // split text to under `MAX_MATRIX_MESSAGE_SIZE` and send as separate events.
        log.info("Mail contents greater than 63k");
        for (let i = 0; i<message.byteLength; i = i + MAX_MATRIX_MESSAGE_SIZE) {
            try {
                await intent.sendText(roomID, message.toString("utf-8", i, i + 62999));
            }
            catch (err) {
                throw Error(`Could not send the text to the room: ${err}`);
            }
        }
    }
    else {
        try {
            await intent.sendText(roomID, text);
        }
        catch (err) {
            throw Error(`Could not send the text to the room: ${err}`);
        }
    }
}


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
            let receivedAddress = getRoomAliasFromEmailTo(session.envelope.rcptTo, config.bridge.domain);
            let alias = "";
            if (receivedAddress instanceof Error) {
                log.error(`Error resolving room address: ${receivedAddress}`);
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
                log.info("Email contents from", fromAdd.address, "will be sent to",
                    `${receivedAddress[1]}:${receivedAddress[2]}`);
            });

            mailparser.on('data', data => {
                if (data.type === 'text') {
                    text = data.text;
                }
            });

            mailparser.on('end', () => {
                handleMail(text, fromAdd, alias, config)
                    .then(() => log.info("Message sent to the room"))
                    .catch((err) => log.error(`Could not handle mail:`, err));
            });

            stream.pipe(mailparser);
            stream.on('end', callback);
        }
    });
    SMTP.listen(config.bridge.mailPort);
};

