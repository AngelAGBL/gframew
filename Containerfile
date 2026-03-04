FROM oven/bun:alpine
COPY ["package.json", "bun.lock", "./"]
RUN apk add --no-cache openssl\
 && openssl req -x509 -nodes -days 365 -keyout server.key -out server.crt \
  -newkey rsa:2048 -subj "/CN=localhost" -addext "subjectAltName = DNS:localhost"\
 && bun i
CMD ["bun", "run", "dev"]
