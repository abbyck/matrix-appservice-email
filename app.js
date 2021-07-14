const { AppServiceRegistration, Cli, } = require("matrix-appservice-bridge");
const { bridge } = require('./src/bridge');


new Cli({
    registrationPath: "email-registration.yaml",
    generateRegistration: function (reg, callback) {
        reg.setId(AppServiceRegistration.generateToken());
        reg.setHomeserverToken(AppServiceRegistration.generateToken());
        reg.setAppServiceToken(AppServiceRegistration.generateToken());
        reg.setSenderLocalpart("email");
        reg.addRegexPattern("users", "@_email_.*", true);
        callback(reg);
    },
    bridgeConfig: {
        schema: "config/email-config-schema.yaml"
    },
    run: bridge
}).run();
