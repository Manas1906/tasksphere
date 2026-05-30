package com.tasksphere.core;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.CommandLineRunner;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.context.annotation.Bean;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.EnableAsync;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

import java.util.concurrent.Executor;

@SpringBootApplication
@EnableAsync
public class TaskSphereApplication {

    private static final Logger log = LoggerFactory.getLogger(TaskSphereApplication.class);

    public static void main(String[] args) {
        SpringApplication.run(TaskSphereApplication.class, args);
    }

    @Bean
    public CommandLineRunner databaseInitializer(JdbcTemplate jdbcTemplate, com.tasksphere.core.repository.UserSessionRepository userSessionRepository) {
        return args -> {
            try {
                String dbName = jdbcTemplate.getDataSource().getConnection().getMetaData().getDatabaseProductName();
                log.info("[DB-INIT] Detected active database product name: {}", dbName);
                
                if ("PostgreSQL".equalsIgnoreCase(dbName)) {
                    log.info("[DB-INIT] Ensuring users.avatar_url column type is TEXT for PostgreSQL...");
                    jdbcTemplate.execute("ALTER TABLE users ALTER COLUMN avatar_url TYPE TEXT;");
                    log.info("[DB-INIT] Ensuring chat_messages.avatar_url column type is TEXT for PostgreSQL...");
                    jdbcTemplate.execute("ALTER TABLE chat_messages ALTER COLUMN avatar_url TYPE TEXT;");
                    log.info("[DB-INIT] Column size upgrade executed successfully!");
                } else if ("H2".equalsIgnoreCase(dbName)) {
                    log.info("[DB-INIT] Ensuring users.avatar_url column size is expanded for H2...");
                    jdbcTemplate.execute("ALTER TABLE users ALTER COLUMN avatar_url VARCHAR(1048576);");
                    log.info("[DB-INIT] Ensuring chat_messages.avatar_url column size is expanded for H2...");
                    jdbcTemplate.execute("ALTER TABLE chat_messages ALTER COLUMN avatar_url VARCHAR(1048576);");
                    log.info("[DB-INIT] Local db column size expanded successfully!");
                }
            } catch (Exception e) {
                log.warn("[DB-INIT-WARNING] Did not execute database column alter: {}", e.getMessage());
            }

            try {
                if (userSessionRepository.findByUsername("Agile_AI_Bot").isEmpty()) {
                    log.info("[DB-INIT] Registering virtual teammate Agile_AI_Bot in database...");
                    com.tasksphere.core.model.UserSession bot = com.tasksphere.core.model.UserSession.builder()
                            .id("agile-ai-bot-uuid-static-1111")
                            .username("Agile_AI_Bot")
                            .role("AI_ASSISTANT")
                            .status("ONLINE")
                            .lastActiveTime(java.time.Instant.now())
                            .build();
                    bot.packMetadata("https://api.dicebear.com/7.x/bottts/svg?seed=AgileAiBot", "ai-bot@tasksphere.com", null, false);
                    userSessionRepository.save(bot);
                    log.info("[DB-INIT] Agile_AI_Bot successfully registered!");
                } else {
                    // Update active status to ONLINE just in case
                    userSessionRepository.findByUsername("Agile_AI_Bot").ifPresent(bot -> {
                        bot.setStatus("ONLINE");
                        bot.setLastActiveTime(java.time.Instant.now());
                        userSessionRepository.save(bot);
                    });
                }
            } catch (Exception e) {
                log.error("[DB-INIT-WARNING] Failed to initialize virtual Agile_AI_Bot teammate: {}", e.getMessage());
            }
        };
    }


    @Bean(name = "taskExecutor")
    public Executor taskExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(2);
        executor.setMaxPoolSize(10);
        executor.setQueueCapacity(500);
        executor.setThreadNamePrefix("TaskSphere-Async-");
        executor.initialize();
        return executor;
    }
}

