# --- Stage 1: Build the Maven Project ---
FROM maven:3.9.6-eclipse-temurin-21-alpine AS builder
WORKDIR /app
COPY pom.xml .
# Download dependencies first to leverage Docker cache layers
RUN maven_opts="-XX:+TieredCompilation -XX:TieredStopAtLevel=1" mvn dependency:go-offline

COPY src ./src
RUN mvn clean package -DskipTests

# --- Stage 2: Runtimes Container Image ---
FROM eclipse-temurin:21-jre-alpine
WORKDIR /app
COPY --from=builder /app/target/core-0.0.1-SNAPSHOT.jar app.jar

EXPOSE 8080
ENTRYPOINT ["java", "-XX:+UseG1GC", "-XX:+ExitOnOutOfMemoryError", "-jar", "app.jar"]
