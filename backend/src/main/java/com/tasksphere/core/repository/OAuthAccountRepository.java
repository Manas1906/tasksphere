package com.tasksphere.core.repository;

import com.tasksphere.core.model.OAuthAccount;
import com.tasksphere.core.model.UserSession;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;
import java.util.Optional;
import java.util.List;

@Repository
public interface OAuthAccountRepository extends JpaRepository<OAuthAccount, String> {
    Optional<OAuthAccount> findByProviderAndProviderUserId(String provider, String providerUserId);
    List<OAuthAccount> findByUser(UserSession user);
}
