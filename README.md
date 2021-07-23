# Matrix Email Bridge

First class email bridge for Matrix.

### Usage:

1. Registration
`node app.js -r -u "http://localhost:8090" # remember to add the registration!`
2. Run the bridge
```node app.js -p 9000```

### Docker

A Dockerfile is included. To use it:

```sh
# To build a docker image
docker build . -t matrix-appservice-email
# Create a new config file
mkdir data
cp config/config.yaml data/config.yaml
# ...and edit that file.
# Generate a registation file
docker run --rm -v $PWD/data:/config matrix-appservice-email node app.js -r -u "http://localhost:8090" -f /config/email-registration.yaml
# To run with default ports (port 25 for SMTP, port 8090 for bridge traffic)
docker run --rm -v $PWD/data:/config matrix-appservice-email
# To run with custom ports
docker run --rm -v $PWD/data:/config -p 127.0.0.1:25:1111/tcp  -p 127.0.0.1:8090:2222/tcp matrix-appservice-email
```