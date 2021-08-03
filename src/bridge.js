const fs = require("fs");
const { Bridge } = require('matrix-appservice-bridge');
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
                if (event.type !== "m.room.message" || !event.content) {
                    return;
                }
                log.info(`Matrix-side: ${event.sender}: ${event}
                RoomID: ${event.room_id}, EventID: ${event.event_id} 
                `);
                sendMessageViaEmail(event.room_id, event);
            }
        }
    });

    const sendMail = require('./email/outbound')({
        // dkim: {
        //     privateKey: fs.readFileSync(config.bridge.dkimPrivateKeyLocation, 'utf8'),
        //     keySelector: config.bridge.dkimSelector,
        // },
        smtpPort: config.bridge.outboundPort,
        smtpHost: config.bridge.smtpHost
    });

    async function sendMessageViaEmail(roomid, event) {
        let roomEmail, roomMembers;
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
                if (typeof roomEmail === "undefined") {
                    const intent = bridge.getIntent(member);
                    let roomAlias;
                    try {
                        roomAlias = await intent.getStateEvent(roomid, 'm.room.canonical_alias');
                        log.info("Room alias:", roomAlias.alias);
                    }
                    catch (ex) {
                        log.error(`Could not get roomAlias`, ex);
                        return;
                    }
                    roomEmail = getRoomMailIdFromRoomAlias(roomAlias.alias, config.bridge.mxDomain);
                    log.info("Room email id:", roomEmail);
                }
                const emailIdOfMember = getMailIdFromUserId(member, config.bridge.domain);
                sendMail({
                    from: roomEmail,
                    to: emailIdOfMember,
                    subject: `You have a message from ${event.sender}`,
                    html: `${event.content.body}`,
                }).then( _ => {
                    log.info(`Message sent from ${roomEmail} to ${roomEmail}`);
                }).catch(ex => {
                    log.error(`Could not sent email from ${roomEmail} to ${roomEmail}: ${ex}`);
                });
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
    const email = userId.slice(8, userId.lastIndexOf(":"+ homeServer));
    const localPart = email.slice(0, email.lastIndexOf('_'));
    const domain = email.slice(email.lastIndexOf('_')+1);
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
