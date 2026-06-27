package com.tasksphere.core.controller;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;
import java.util.HashMap;
import java.util.Map;

@RestController
@RequestMapping("/api")
@CrossOrigin(origins = "*", allowedHeaders = "*")
public class UploadController {

    private static final Logger log = LoggerFactory.getLogger(UploadController.class);

    /**
     * Resolve the uploads directory.
     * Priority: UPLOAD_DIR env variable → <tmpdir>/tasksphere-uploads
     * Using the system temp directory ensures writeability on all cloud platforms
     * (Render, Koyeb, Railway, etc.) where the working directory may be read-only.
     */
    private static final File UPLOADS_DIR;
    static {
        String envPath = System.getenv("UPLOAD_DIR");
        File dir;
        if (envPath != null && !envPath.isBlank()) {
            dir = new File(envPath);
        } else {
            // Stable writable location that exists on every OS and cloud container
            dir = new File(System.getProperty("java.io.tmpdir"), "tasksphere-uploads");
        }
        dir.mkdirs();
        UPLOADS_DIR = dir;
        // Note: Static initializer cannot use instance logger, so this will be logged on first request
    }

    @PostMapping("/upload")
    public ResponseEntity<Map<String, Object>> uploadFile(@RequestParam("file") MultipartFile file) {
        Map<String, Object> response = new HashMap<>();

        if (file.isEmpty()) {
            response.put("success", false);
            response.put("error", "Uploaded file is empty");
            return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(response);
        }

        if (!UPLOADS_DIR.canWrite()) {
            response.put("success", false);
            response.put("error", "Upload directory is not writable on this server");
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(response);
        }

        try {
            // Sanitize filename to protect against path traversal attacks
            String originalFilename = file.getOriginalFilename();
            String safeFilename = "uploaded_file";
            if (originalFilename != null && !originalFilename.isBlank()) {
                safeFilename = originalFilename.replaceAll("[^a-zA-Z0-9\\.\\-_]", "_");
            }

            // Add unique timestamp prefix to prevent collisions
            String uniqueFilename = System.currentTimeMillis() + "_" + safeFilename;

            Path dest = Paths.get(UPLOADS_DIR.getAbsolutePath(), uniqueFilename);
            Files.copy(file.getInputStream(), dest, StandardCopyOption.REPLACE_EXISTING);

            // Public path served by WebConfig resources handler
            String fileUrl = "/api/uploads/" + uniqueFilename;

            response.put("success", true);
            response.put("fileUrl", fileUrl);
            response.put("fileName", originalFilename);
            response.put("fileSize", file.getSize());

            log.info("Saved file: {} ({} bytes) at {}", uniqueFilename, file.getSize(), dest);
            return ResponseEntity.ok(response);

        } catch (IOException e) {
            log.error("Upload saving failed: {}", e.getMessage());
            response.put("success", false);
            response.put("error", "Failed to save file: " + e.getMessage());
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(response);
        }
    }

    @ExceptionHandler(org.springframework.web.multipart.MaxUploadSizeExceededException.class)
    public ResponseEntity<Map<String, Object>> handleMaxSizeException(org.springframework.web.multipart.MaxUploadSizeExceededException exc) {
        Map<String, Object> response = new HashMap<>();
        response.put("success", false);
        response.put("error", "File too large. Maximum allowed size is 10MB.");
        return ResponseEntity.status(HttpStatus.PAYLOAD_TOO_LARGE).body(response);
    }
}
