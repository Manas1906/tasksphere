# --- Stage 1: Build the Maven Project ---
FROM maven:3.9.6-eclipse-temurin-21-alpine AS builder
WORKDIR /app

# Optimize Maven memory footprint for resource-constrained environments (like Render free tier)
ENV MAVEN_OPTS="-XX:+TieredCompilation -XX:TieredStopAtLevel=1"

# Copy parent and module POMs
COPY pom.xml .
COPY core-shared/pom.xml ./core-shared/
COPY auth-service/pom.xml ./auth-service/
COPY chat-service/pom.xml ./chat-service/
COPY task-service/pom.xml ./task-service/
COPY app-monolith/pom.xml ./app-monolith/

# Pre-cache dependencies to leverage Docker layer caching
RUN mvn dependency:go-offline -B

# Copy source code files for each module
COPY core-shared/src ./core-shared/src
COPY auth-service/src ./auth-service/src
COPY chat-service/src ./chat-service/src
COPY task-service/src ./task-service/src
COPY app-monolith/src ./app-monolith/src

# Compile and package the monolith runner
RUN mvn clean package -DskipTests

# --- Stage 2: Runtimes Container Image ---
FROM eclipse-temurin:21-jre-alpine
WORKDIR /app

# Copy the built monolithic runner jar
COPY --from=builder /app/app-monolith/target/app-monolith-0.0.1-SNAPSHOT.jar app.jar

EXPOSE 8080

# Configure JVM tuning for low-memory constraint (512MB RAM free tier limit on Render)
ENTRYPOINT ["java", "-XX:+UseG1GC", "-XX:+ExitOnOutOfMemoryError", "-XX:MaxRAMPercentage=75.0", "-jar", "app.jar"]
