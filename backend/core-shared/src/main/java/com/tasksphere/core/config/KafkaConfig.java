package com.tasksphere.core.config;

import org.springframework.boot.autoconfigure.kafka.KafkaAutoConfiguration;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Profile;

@Configuration
@Profile("kafka")
@Import(KafkaAutoConfiguration.class)
public class KafkaConfig {
}
