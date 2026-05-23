package com.tasksphere.core;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableAsync;

@SpringBootApplication
@EnableAsync
public class TaskSphereApplication {
    public static void main(String[] args) {
        SpringApplication.run(TaskSphereApplication.class, args);
    }
}
