FROM node:16-slim

WORKDIR /app
COPY . .
RUN npm ci --cache /tmp/empty-cache

EXPOSE 25/tcp
EXPOSE 8090/tcp
VOLUME ["/config"]

ENTRYPOINT [ "node", "app.js", "-c", "/config/config.yaml",  "-f", "/config/email-registration.yaml", "-p", "8090" ]
