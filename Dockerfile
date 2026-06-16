FROM node:22-slim

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy application code
COPY . .

# Ensure data directory exists for auth sessions
RUN mkdir -p data/sessions

EXPOSE 3000

CMD ["npm", "start"]
