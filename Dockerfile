# Use an official Node.js runtime as a parent image
FROM node:18-alpine

# Set the working directory in the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json (or yarn.lock)
COPY package*.json ./

# Install project dependencies
RUN npm ci

# Copy the rest of the application code
COPY . .

# Application port (if any)
# EXPOSE 3000

# Define environment variables (if any)
# ENV VAR_NAME=value

# Command to run the application
CMD [ "sh", "-c", "npm run register && node app.js" ]
