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
    throw Error("To address does not contain a valid recipient");
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
    throw Error("Could not resolve UserID or Alias from the received localPart");
};


/***
 * Send the inbound mail's contents to the corresponding rooms.
 * @param {string}  text    The text content of the email.
 * @param {string}  toAdd
 * @param {ParsedMailbox}  fromAdd Email address of the sender.
 * @param {address} from    The from address object from email header.
 * @param {object}  config  Bridge configurations.
 * @returns {Promise<void>}
 */
async function handleMail(text, toAdd, fromAdd, from, config) {
    let alias = "", matrixId = "", roomID = "", receivedAddress;
    try {
        receivedAddress = getRoomAliasFromEmailTo(toAdd, config.bridge.domain);
        if (receivedAddress[0] === "room") {
            alias = `#${receivedAddress[1]}:${receivedAddress[2]}`;
        }
        else if (receivedAddress[0] === "user") {
            matrixId = `@${receivedAddress[1]}:${receivedAddress[2]}`;
        }
    }
    catch (ex) {
        log.error(`Error resolving room address: ${ex}`);
        //TODO: Send a reply to the sender indicating `unable to resolve room`
        throw Error("Unable to resolve the room");
    }
    if (!text.trim().length) {
        // text only contains whitespace (ie. spaces, tabs or line breaks)
        log.warn("Inbound email contains whitespace only");
        throw Error(`Inbound email contains whitespace only, ignoring this empty message from ${fromAdd.address}`);
    }

    log.info("Inbound email contents: "+ text.substring(0, 10) + "... ");
    log.info("Email contents from", fromAdd.address, "will be sent to",
        `${receivedAddress[1]}:${receivedAddress[2]}`);

    const fromId = `@_email_${fromAdd.local }_${fromAdd.domain}:${config.bridge.domain}`;
    const intent = bridge.getIntent(fromId);
    const displayName = from.value[0].name !== "" ? `${from.value[0].name}` : `${fromAdd.address}`;
    await intent.setDisplayName(displayName);
    let message = Buffer.from(text, "utf-8");

    if (alias) {
        // Destination is a public room.
        roomID = await intent.resolveRoom(alias);
    }
    else {
        let dmMappings;
        const botClient = bridge.getIntent().getClient();
        // check the DM recipient exists
        try {
            await botClient.getProfileInfo(matrixId);
        }
        catch (ex) {
            throw Error(`Could not find the recipient user(DM) ${ex}`);
        }
        // Check the bridge bot's account_data for existing DM relations.
        try {
            dmMappings = await botClient.getAccountDataFromServer("me.abhy.email-bridge");
        }
        catch (ex) {
            throw Error(`Could not get DM room mappings from bot's account data ${ex}`);
        }
        if (matrixId in dmMappings) {
            roomID = dmMappings[matrixId].roomId;
        }
        else {
            try {
                // Create a new DM and invite the [m] user
                roomID = (await intent.createRoom({
                    createAsClient: true,
                    options: {
                        name: (displayName + " (PM via email)"),
                        visibility: "private",
                        creation_content: {
                            "m.federate": true
                        },
                        // preset: "trusted_private_chat",
                        is_direct: true,
                        invite: [matrixId],
                        initial_state: [{
                            content: {
                                users: {
                                    [matrixId]: 10,
                                    [fromId]: 100,
                                },
                                events: {
                                    "m.room.avatar": 10,
                                    "m.room.name": 10,
                                    "m.room.canonical_alias": 100,
                                    "m.room.history_visibility": 100,
                                    "m.room.power_levels": 100,
                                    "m.room.encryption": 100
                                },
                                invite: 100,
                            },
                            type: "m.room.power_levels",
                            state_key: "",
                        }],
                    }
                })).room_id;
            }
            catch (ex) {
                throw Error(`Could not create a new DM with ${fromAdd.address} & ${matrixId}: ${ex}`);
            }
            try {
                // Store the mappings to the bot's account data.
                await botClient.setAccountData("me.abhy.email-bridge", {
                    ...dmMappings,
                    [matrixId]: {
                        "roomId": roomID,
                        "emailUser": fromId,
                    }
                });
            }
            catch (ex) {
                // (Leave the created room -> inform the sender?)
                throw Error("Could not store update the DM mappings");
            }
        }
    }
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
            let subject, text, from;
            const mailparser = new MailParser();
            const fromAddress = ParseEmailAddress.parseOneAddress(session.envelope.mailFrom.address);
            const toAddress = session.envelope.rcptTo;
            mailparser.on('headers', headers => {
                subject = headers.get('subject');
                from = headers.get('from');
            });

            mailparser.on('data', data => {
                if (data.type === 'text') {
                    text = data.text;
                }
            });

            mailparser.on('end', () => {
                handleMail(text, toAddress, fromAddress, from, config)
                    .then(() => log.info("Message sent to the room"))
                    .catch((err) => log.error(`Could not handle mail:`, err));
            });

            stream.pipe(mailparser);
            stream.on('end', callback);
        }
    });
    SMTP.listen(config.email.inboundPort);
};
