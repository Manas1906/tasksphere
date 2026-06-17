package com.tasksphere.core.repository;

import com.tasksphere.core.model.FeatureToggle;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.Optional;

@Repository
public interface FeatureToggleRepository extends JpaRepository<FeatureToggle, Long> {

    Optional<FeatureToggle> findByFeatureKey(String featureKey);
}
