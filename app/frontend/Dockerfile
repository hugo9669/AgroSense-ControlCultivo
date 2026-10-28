FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
RUN apk add --no-cache openssl && \
    mkdir -p /etc/nginx/ssl && \
    openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
      -keyout /etc/nginx/ssl/agrosense.key \
      -out /etc/nginx/ssl/agrosense.crt \
      -subj "/C=CO/ST=Bogota/L=Bogota/O=AgroSense/OU=IoT/CN=32.193.138.160" \
      -addext "subjectAltName=IP:32.193.138.160,DNS:localhost"
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
