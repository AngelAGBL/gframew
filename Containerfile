FROM node:22-alpine

WORKDIR /app

# Copy package files
COPY package.json ./

# Install dependencies with npm
RUN npm install

# Copy application files
COPY . .

# Expose port
EXPOSE 1965

# Run with Node.js
CMD ["node", "--loader", "tsx", "src/app.ts"]

