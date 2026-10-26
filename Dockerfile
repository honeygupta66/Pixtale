FROM node:20-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy application code
COPY . .

# Expose server port
EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000

# Start server
CMD ["npm", "start"]
