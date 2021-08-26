const fs = require("fs");
const { Bridge, MatrixUser } = require('matrix-appservice-bridge');
const { startSMTP } = require('./email');
const { Logging } = require('./log');

const log = Logging.get("bridge");

exports.bridge = async function(port, config, registration) {
    bridge = new Bridge({
        homeserverUrl: config.bridge.homeserverUrl,
        domain: config.bridge.domain,
        registration,

        controller: {
            onUserQuery: function(queriedUser) {
                return {}; // auto-provision users with no additional data
            },

            onEvent: function(request, context) {
                // events from matrix
                const event = request.getData();
                console.log(event);
                if (event.type === "m.room.member" && event.state_key) {
                    // Check DM leave
                    if (event.content.membership === "leave") {
                        checkMappingsAndLeaveDM(event.state_key, event.room_id);
                    }
                }
                if (event.type !== "m.room.message" || !event.content) {
                    return;
                }
                log.info(`Matrix-side: ${event.sender}:
                RoomID: ${event.room_id}, EventID: ${event.event_id}`);
                sendMessageViaEmail(event.room_id, event);
            }
        }
    });

    const sendMail = require('./email/outbound')({
        startTLS: config.email.tls.enabled,
        tls: {
            key: fs.existsSync(config.email.tls.tlsKey) ? fs.readFileSync(config.email.tlsKey) : '',
            cert: fs.existsSync(config.email.tls.tlsCert) ? fs.readFileSync(config.email.tls.tlsCert) : '',
        },
        dkimEnabled: config.email.dkim.enabled,
        dkim: {
            privateKey: fs.existsSync(config.email.dkim.dkimKey) ?
                fs.readFileSync(config.email.dkim.dkimKey, 'utf8') : '',
            keySelector: config.email.dkim.selector,
        },
        smtpPort: config.email.outboundPort,
        smtpHost: config.email.smtpHost
    });

    async function sendMessageViaEmail(roomid, event) {
        const botClient = bridge.getIntent().getClient();
        let roomEmail, roomMembers, dmMappings;
        try {
            dmMappings = await botClient.getAccountDataFromServer("me.abhy.email-bridge");
        }
        catch (ex) {
            log.error(`Could not fetch the DM Mappings from account data: ${ex}`);
        }
        // Check if the user ID is in DM mappings.
        if (event.user_id in dmMappings) {
           log.info('Sender is in DM mappings');
            // Check if the roomID mapping
            if (dmMappings[event.user_id].roomId === event.room_id) {
                log.info('Message is from a DM');
                roomEmail = getRoomMailIdFromUserId(event.user_id, config.email.mxDomain);
                sendMail({
                    from: roomEmail,
                    to: getMailIdFromUserId(dmMappings[event.user_id].emailUser),
                    subject: `You have a message from ${event.sender}`,
                    html: `${event.content.body}`,
                }).then( () => {
                    log.info(`Message sent from ${roomEmail} to ${roomEmail}`);
                }).catch(ex => {
                    throw Error(`Could not sent email from ${roomEmail} to ${roomEmail}: ${ex}`);
                });
                return;
            }
        }
        const ASBot = bridge.getBot();
        try {
            roomMembers = await ASBot.getJoinedMembers(roomid).catch();
        }
        catch (ex) {
            log.error(`Could not get room member list`, ex);
            return;
        }
        for (let member in roomMembers) {
            if (ASBot.isRemoteUser(member)) {
                log.info("Remote email userId", member);
                // Query for `m.room.canonical_alias` only if roomEmail is undefined(first occurrence).
                let roomAlias;
                if (!roomEmail) {
                    const intent = bridge.getIntent(member);
                    try {
                        roomAlias = await intent.getStateEvent(roomid, 'm.room.canonical_alias');
                        log.info("Room alias:", roomAlias.alias);
                    }
                    catch (ex) {
                        log.error(`Could not get roomAlias`, ex);
                        return;
                    }
                    roomEmail = getRoomMailIdFromRoomAlias(roomAlias.alias, config.email.mxDomain);
                    log.info("Room email id:", roomEmail);
                }
                const emailIdOfMember = getMailIdFromUserId(member, config.bridge.domain);
                sendMail({
                    from: roomEmail,
                    to: emailIdOfMember,
                    subject: `You have a message from ${roomAlias.alias}`,
                    html: `${event.content.body}`,
                }).then( _ => {
                    log.info(`Message sent from ${roomEmail} to ${roomEmail}`);
                }).catch(ex => {
                    log.error(`Could not sent email from ${roomEmail} to ${roomEmail}: ${ex}`);
                });
            }
        }
    }

    async function checkMappingsAndLeaveDM(sender, roomId) {
        let dmMappings;
        const botClient = bridge.getIntent().getClient();
        try {
            dmMappings = await botClient.getAccountDataFromServer('me.abhy.email-bridge');
        }
        catch (ex) {
                throw Error(`Failed to get DM mappings from HS: ${ex}`);
        }
        if (sender in dmMappings && dmMappings[sender].roomId === roomId) {
            log.info(`${sender} left from DM room ${roomId}`);
            const intent = bridge.getIntent(dmMappings[sender].emailUser);
            try {
                await intent.leave(roomId, "Empty room");
            }
            catch (ex) {
                throw Error(`${sender} could not leave the empty room: ${ex}`);
            }
            try {
                delete dmMappings[sender];
                await botClient.setAccountData('me.abhy.email-bridge', dmMappings);
            }
            catch (ex) {
                throw Error(`Could not update the DM Mappings: ${ex}`);
            }
        }
    }

    process.on('SIGINT', async () => {
        // Handle Ctrl-C
        log.info(`Closing bridge due to SIGINT`);
        try {
            await bridge.appService.close();
            process.exit(0);
        }
        catch (ex) {
            log.error(`Ungraceful shutdown:`, ex);
            process.exit(1);
        }
    });

    // Check if the homeserver is up yet.
    let ready = false;
    await bridge.initalise();
    do {
        try {
            log.info(`Checking connection to the HS..`);
            // Simple call.
            await bridge.botClient.getVersions();
            log.info(`HS connection ready`);
            break;
        }
        catch (ex) {
            log.error('Could not verify HS connection, retrying in 5s.');
            await new Promise(res => setTimeout(res, 5000)); // Wait 5s before reattempting
        }
    } while (!ready);

    startSMTP(config);
    bridge.listen(port, config);
    log.info("Matrix-side listening on port:", port);
};

/**
 * Returns the email address obtained from Matrix UserId
 * @param userId        userId in the format `@_email_<localPart>_<domain.tld>:localhost`.
 * @param homeServer    homeServer address.
 * @returns {string}    Email-ID obtained from bridge userID `localPart@domain.tld`.
 */
function getMailIdFromUserId(userId, homeServer) {
    const mUserId = new MatrixUser(userId);
    const emailPart = mUserId.localpart.slice('@email_'.length);
    const localPart = emailPart.slice(0, emailPart.lastIndexOf('_'));
    const domain = emailPart.slice(emailPart.lastIndexOf('_')+1);
    return `${localPart}@${domain}`;
}

/**
 * Returns the email address for a provided roomAlias
 * @param roomAlias     Corresponding Room alias.
 * @param mxDomain      SMTP listening domain.
 * @returns {string}    Email address in the format `room+<alias>_<homeserver>@matrix.org`
 */
function getRoomMailIdFromRoomAlias(roomAlias, mxDomain) {
    const alias = roomAlias.slice(1, roomAlias.lastIndexOf(":"));
    const homeServer = roomAlias.slice(roomAlias.lastIndexOf(":")+1);
    return `room+${alias}_${homeServer}@${mxDomain}`;
}

/**
 * Returns the email address for a userID
 * @param userId        Corresponding user ID.
 * @param mxDomain      SMTP listening domain.
 * @returns {string}    Email address in the format `room+<alias>_<homeserver>@matrix.org`
 */
function getRoomMailIdFromUserId(userId, mxDomain) {
    const localPart = userId.slice(1, userId.lastIndexOf(":"));
    const homeServer = userId.slice(userId.lastIndexOf(":")+1);
    return `user+${localPart}_${homeServer}@${mxDomain}`;
}
