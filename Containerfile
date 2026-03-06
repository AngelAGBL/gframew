FROM oven/bun:alpine
COPY ["package.json", "bun.lock", "./"]
RUN  ["bun", "i"]
COPY ["./", "./"]
CMD  ["bun", "run", "start"]
