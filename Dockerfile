# Use Node.js 18 LTS as base image
FROM ubuntu:22.04

RUN apt-get update; apt-get clean


RUN apt-get install -y wget

RUN apt-get install -y gnupg


RUN wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add - \
    && echo "deb http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google.list



RUN apt-get update && apt-get -y install google-chrome-stable

ENV DEBIAN_FRONTEND=noninteractive

# Install required dependencies
RUN apt-get update && apt-get install -y curl ca-certificates gnupg \
    && mkdir -p /etc/apt/keyrings \
    # Add NodeSource GPG key
    && curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
        | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg \
    # Add NodeSource repo for Node.js 20.x
    && echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" \
        > /etc/apt/sources.list.d/nodesource.list \
    && apt-get update \
    # Install Node.js
    && apt-get install -y nodejs \
    # Cleanup
    && rm -rf /var/lib/apt/lists/*


# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# # Install dependencies

# Copy source code
COPY . .

# Create tmp directory for downloads
RUN mkdir -p /tmp

# Create non-root user for security
RUN groupadd -r nodeuser && useradd -r -g nodeuser -G audio,video nodeuser \
    && mkdir -p /home/nodeuser/Downloads \
    && chown -R nodeuser:nodeuser /home/nodeuser \
    && chown -R nodeuser:nodeuser /app \
    && chown -R nodeuser:nodeuser /tmp

# Set Puppeteer to use installed Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable

# Expose port
EXPOSE 3000

# Switch to non-root user
# USER root

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

# Start the application
CMD ["npm", "start"]
