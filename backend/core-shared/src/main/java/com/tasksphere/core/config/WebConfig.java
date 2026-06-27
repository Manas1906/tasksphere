package com.tasksphere.core.config;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;
import java.io.File;

@Configuration
public class WebConfig implements WebMvcConfigurer {

    private static final Logger log = LoggerFactory.getLogger(WebConfig.class);

    /**
     * Mirrors the uploads directory resolution logic in UploadController.
     * Must resolve to the same absolute path so that files saved by the controller
     * are served correctly by this static resource handler.
     */
    private static final File UPLOADS_DIR;
    static {
        String envPath = System.getenv("UPLOAD_DIR");
        File dir;
        if (envPath != null && !envPath.isBlank()) {
            dir = new File(envPath);
        } else {
            dir = new File(System.getProperty("java.io.tmpdir"), "tasksphere-uploads");
        }
        dir.mkdirs();
        UPLOADS_DIR = dir;
    }

    @Override
    public void addResourceHandlers(ResourceHandlerRegistry registry) {
        String absolutePath = UPLOADS_DIR.getAbsolutePath();
        if (!absolutePath.endsWith(File.separator)) {
            absolutePath += File.separator;
        }

        // Map URL requests on /api/uploads/** to the resolved disk path
        registry.addResourceHandler("/api/uploads/**")
                .addResourceLocations("file:" + absolutePath);

        log.info("Static resources registered mapping '/api/uploads/**' to: {} | writable={}", absolutePath, UPLOADS_DIR.canWrite());
    }
}
