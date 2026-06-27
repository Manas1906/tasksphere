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
 * Sends Web Push reminders for tasks due today or tomorrow.
 * Runs daily at 09:00 server time.
 */
@Service
public class DueDateReminderService {

    private static final Logger log = LoggerFactory.getLogger(DueDateReminderService.class);

    @Autowired
    private TaskRepository taskRepository;

    @Autowired
    private WebPushService webPushService;

    @Scheduled(cron = "0 0 9 * * *")
    @Transactional(readOnly = true)
    public void sendDueDateReminders() {
        LocalDate today = LocalDate.now();
        LocalDate tomorrow = today.plusDays(1);

        List<Task> allTasks = taskRepository.findAll();
        int reminders = 0;

        for (Task task : allTasks) {
            if (task.getDueDate() == null) continue;
            if ("DONE".equals(task.getStatus())) continue;
            if (task.getAssignee() == null) continue;

            LocalDate due = task.getDueDate();
            String recipient = task.getAssignee().getUsername();

            if (due.equals(today)) {
                webPushService.sendNotification(recipient,
                        "🔥 Task Due Today",
                        "\"" + task.getTitle() + "\" is due today. Time to wrap it up!",
                        "/");
                reminders++;
            } else if (due.equals(tomorrow)) {
                webPushService.sendNotification(recipient,
                        "⏰ Task Due Tomorrow",
                        "\"" + task.getTitle() + "\" is due tomorrow. Don't forget!",
                        "/");
                reminders++;
            } else if (due.isBefore(today)) {
                webPushService.sendNotification(recipient,
                        "🚨 Overdue Task",
                        "\"" + task.getTitle() + "\" was due on " + due + " and is overdue.",
                        "/");
                reminders++;
            }
        }

        if (reminders > 0) {
            log.info("[DUE-DATE-REMINDER] Sent {} due date push notifications", reminders);
        }
    }
}
