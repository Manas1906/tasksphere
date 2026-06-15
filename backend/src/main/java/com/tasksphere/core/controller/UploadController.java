package com.tasksphere.core.controller;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import java.io.File;
import java.io.IOException;
import java.util.HashMap;
import java.util.Map;

@RestController
@RequestMapping("/api")
@CrossOrigin(origins = "*", allowedHeaders = "*")
public class UploadController {

    @PostMapping("/upload")
    public ResponseEntity<Map<String, Object>> uploadFile(@RequestParam("file") MultipartFile file) {
        Map<String, Object> response = new HashMap<>();
        
        if (file.isEmpty()) {
            response.put("success", false);
            response.put("error", "Uploaded file is empty");
            return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(response);
        }

        try {
            // Ensure target uploads folder exists
            File uploadsDir = new File("uploads");
            if (!uploadsDir.exists()) {
                uploadsDir.mkdirs();
            }

            // Sanitize filename to protect against path traversal attacks
            String originalFilename = file.getOriginalFilename();
            String safeFilename = "uploaded_file";
            if (originalFilename != null) {
                // Keep only safe characters and replace others with underscore
                safeFilename = originalFilename.replaceAll("[^a-zA-Z0-9\\.\\-_]", "_");
            }
            
            // Add unique timestamp prefix to prevent collisions
            String uniqueFilename = System.currentTimeMillis() + "_" + safeFilename;
            
            File dest = new File(uploadsDir, uniqueFilename);
            file.transferTo(dest.getAbsoluteFile());
            
            // Public path served by WebConfig resources handler
            String fileUrl = "/api/uploads/" + uniqueFilename;
            
            response.put("success", true);
            response.put("fileUrl", fileUrl);
            response.put("fileName", originalFilename);
            response.put("fileSize", file.getSize());
            
            System.out.println("[UploadController] Saved file: " + uniqueFilename + " (" + file.getSize() + " bytes)");
            return ResponseEntity.ok(response);
            
        } catch (IOException e) {
            System.err.println("[UploadController] Upload saving failed: " + e.getMessage());
            response.put("success", false);
            response.put("error", "Failed to save file: " + e.getMessage());
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(response);
        }
    }
}
