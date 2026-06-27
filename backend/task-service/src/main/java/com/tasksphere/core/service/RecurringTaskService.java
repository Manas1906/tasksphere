package com.tasksphere.core.service;

import com.tasksphere.core.model.Task;
import com.tasksphere.core.repository.TaskRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.util.List;

/**
 * Automatically spawns the next occurrence of recurring tasks.
 * Runs daily at midnight.
 */
@Service
public class RecurringTaskService {

    private static final Logger log = LoggerFactory.getLogger(RecurringTaskService.class);

    @Autowired
    private TaskRepository taskRepository;

    @Autowired
    private TaskService taskService;

    @Scheduled(cron = "0 0 0 * * *")
    @Transactional
    public void processRecurringTasks() {
        LocalDate today = LocalDate.now();
        List<Task> allTasks = taskRepository.findAll();
        int created = 0;

        for (Task task : allTasks) {
            if (task.getRecurringType() == null || "NONE".equals(task.getRecurringType())) continue;
            if (!"DONE".equals(task.getStatus())) continue; // Only recur completed tasks

            LocalDate nextDue = computeNextDueDate(task.getDueDate() != null ? task.getDueDate() : today, task.getRecurringType());
            if (nextDue == null) continue;

            // Check if a recurring child was already created (avoid duplicates by title match)
            boolean alreadyExists = allTasks.stream()
                    .anyMatch(t -> t.getTitle().equals(task.getTitle())
                            && "TODO".equals(t.getStatus())
                            && nextDue.equals(t.getDueDate()));
            if (alreadyExists) continue;

            Task nextTask = Task.builder()
                    .title(task.getTitle())
                    .description(task.getDescription())
                    .status("TODO")
                    .priority(task.getPriority())
                    .storyPoints(task.getStoryPoints())
                    .dueDate(nextDue)
                    .assignee(task.getAssignee())
                    .recurringType(task.getRecurringType())
                    .build();

            taskService.createTask(nextTask);
            created++;
            log.info("[RECURRING] Created next occurrence of \"{}\" due {}", task.getTitle(), nextDue);
        }

        if (created > 0) {
            log.info("[RECURRING] Auto-created {} recurring task(s)", created);
        }
    }

    private LocalDate computeNextDueDate(LocalDate base, String recurringType) {
        return switch (recurringType) {
            case "DAILY"     -> base.plusDays(1);
            case "WEEKLY"    -> base.plusWeeks(1);
            case "BIWEEKLY"  -> base.plusWeeks(2);
            case "MONTHLY"   -> base.plusMonths(1);
            default          -> null;
        };
    }
}
