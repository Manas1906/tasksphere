# --- Stage 1: Build the Vite static assets ---
FROM node:20-alpine AS builder
WORKDIR /app

# Copy package descriptors first to optimize caching of node_modules
COPY package*.json ./
RUN npm ci

# Copy application files and compile production build
COPY . .
RUN npm run build

# --- Stage 2: Serve using Nginx and act as API Proxy ---
FROM nginx:1.25-alpine

# Copy custom Nginx configuration to support SPA routing and reverse-proxying API calls
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy build artifacts to Nginx default HTML directory
WORKDIR /usr/share/nginx/html
COPY --from=builder /app/dist .

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
