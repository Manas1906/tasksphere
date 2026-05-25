package com.tasksphere.core;

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

    public static void main(String[] args) {
        SpringApplication.run(TaskSphereApplication.class, args);
    }

    @Bean
    public CommandLineRunner databaseInitializer(JdbcTemplate jdbcTemplate) {
        return args -> {
            try {
                String dbName = jdbcTemplate.getDataSource().getConnection().getMetaData().getDatabaseProductName();
                System.out.println("[DB-INIT] Detected active database product name: " + dbName);
                
                if ("PostgreSQL".equalsIgnoreCase(dbName)) {
                    System.out.println("[DB-INIT] Ensuring users.avatar_url column type is TEXT for PostgreSQL...");
                    jdbcTemplate.execute("ALTER TABLE users ALTER COLUMN avatar_url TYPE TEXT;");
                    System.out.println("[DB-INIT] Column size upgrade executed successfully!");
                } else if ("H2".equalsIgnoreCase(dbName)) {
                    System.out.println("[DB-INIT] Ensuring users.avatar_url column size is expanded for H2...");
                    jdbcTemplate.execute("ALTER TABLE users ALTER COLUMN avatar_url VARCHAR(1048576);");
                    System.out.println("[DB-INIT] Local db column size expanded successfully!");
                }
            } catch (Exception e) {
                System.err.println("[DB-INIT-WARNING] Did not execute database column alter: " + e.getMessage());
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

