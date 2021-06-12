const Cli = require("matrix-appservice-bridge").Cli;
const AppServiceRegistration = require("matrix-appservice-bridge").AppServiceRegistration;
const { bridge } = require('./src/bridge');

new Cli({
    registrationPath: "email-registration.yaml",
    generateRegistration: function(reg, callback) {
        reg.setId(AppServiceRegistration.generateToken());
        reg.setHomeserverToken(AppServiceRegistration.generateToken());
        reg.setAppServiceToken(AppServiceRegistration.generateToken());
        reg.setSenderLocalpart("email");
        reg.addRegexPattern("users", "@_email_.*", true);
        callback(reg);
    },
    run: bridge
}).run();
