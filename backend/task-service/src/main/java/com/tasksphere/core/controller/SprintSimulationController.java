package com.tasksphere.core.controller;

import com.tasksphere.core.service.SprintSimulationService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

@RestController
@RequestMapping("/api/sprint-simulation")
public class SprintSimulationController {

    private static final Logger log = LoggerFactory.getLogger(SprintSimulationController.class);

    @Autowired
    private SprintSimulationService sprintSimulationService;

    /**
     * Executes the predictive AI Monte Carlo sprint simulation.
     */
    @PostMapping("/run")
    public ResponseEntity<SprintSimulationService.SprintForecastResponse> runSimulation() {
        System.out.println("[API-SIMULATION-POST] Initiating predictive sprint analysis...");
        SprintSimulationService.SprintForecastResponse response = sprintSimulationService.runSprintSimulation();
        return ResponseEntity.ok(response);
    }
}
