package com.tasksphere.core.controller;

import com.tasksphere.core.model.KanbanColumn;
import com.tasksphere.core.repository.KanbanColumnRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/kanban-columns")
public class KanbanColumnController {

    private static final Logger log = LoggerFactory.getLogger(KanbanColumnController.class);

    @Autowired
    private KanbanColumnRepository columnRepository;

    @GetMapping
    public ResponseEntity<List<KanbanColumn>> getColumns() {
        return ResponseEntity.ok(columnRepository.findAllByOrderByPositionAsc());
    }

    @PostMapping
    public ResponseEntity<KanbanColumn> createColumn(@RequestBody KanbanColumn col) {
        log.info("[KANBAN-COLUMNS] Creating column key='{}' name='{}'", col.getColumnKey(), col.getColumnName());
        return new ResponseEntity<>(columnRepository.save(col), HttpStatus.CREATED);
    }

    @PutMapping("/{id}")
    public ResponseEntity<KanbanColumn> updateColumn(@PathVariable Long id,
                                                      @RequestBody KanbanColumn col) {
        return columnRepository.findById(id).map(existing -> {
            existing.setColumnName(col.getColumnName());
            existing.setPosition(col.getPosition());
            existing.setColor(col.getColor());
            log.info("[KANBAN-COLUMNS] Updated column #{}", id);
            return ResponseEntity.ok(columnRepository.save(existing));
        }).orElse(ResponseEntity.notFound().build());
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> deleteColumn(@PathVariable Long id) {
        columnRepository.deleteById(id);
        log.info("[KANBAN-COLUMNS] Deleted column #{}", id);
        return ResponseEntity.noContent().build();
    }
}
