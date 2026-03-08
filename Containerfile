FROM node:25-alpine
WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .
EXPOSE 1965
CMD ["node", "src/app.ts"]