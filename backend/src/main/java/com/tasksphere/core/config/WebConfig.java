package com.tasksphere.core.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;
import java.io.File;

@Configuration
public class WebConfig implements WebMvcConfigurer {

    @Override
    public void addResourceHandlers(ResourceHandlerRegistry registry) {
        // Ensure local uploads directory exists
        File uploadsDir = new File("uploads");
        if (!uploadsDir.exists()) {
            uploadsDir.mkdirs();
        }
        
        String absolutePath = uploadsDir.getAbsolutePath();
        if (!absolutePath.endsWith(File.separator)) {
            absolutePath += File.separator;
        }

        // Map URL requests on /api/uploads/** to the absolute disk path
        registry.addResourceHandler("/api/uploads/**")
                .addResourceLocations("file:" + absolutePath);
                
        System.out.println("[WebConfig] Static resources registered mapping '/api/uploads/**' to: " + absolutePath);
    }
}
