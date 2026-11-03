<template>
  <div class="settings-page">
    <!-- SVG Filter Definition -->
    <svg width="0" height="0" style="position: absolute;">
      <filter id="chaos-glitch">
        <feTurbulence type="fractalNoise" baseFrequency="0.02" numOctaves="3" result="turbulence" seed="2" />
        <feDisplacementMap in2="turbulence" in="SourceGraphic" scale="2" xChannelSelector="R" yChannelSelector="G" />
      </filter>
    </svg>

    <!-- Header Section -->
    <div class="dashboard-header" style="background-color: #000000;">
      <div class="container-fluid">
        <div class="row align-items-center">
          <div class="col-12 col-md-8">
            <div class="header-content px-3 px-md-4 py-3 py-md-0">
              <div class="d-flex flex-column flex-md-row align-items-start align-items-md-center">
                <img src="../assets/CM-icon.png" alt="ChaosMonkey.dev Logo" class="me-3 dashboard-logo">
                <link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&display=swap" rel="stylesheet">
                <div>
                  <h1 
                    class="dashboard-title mb-0" 
                    style="font-family: 'Bebas Neue'; filter: url(#chaos-glitch); cursor: pointer;"
                    @click="goToDashboards"
                  >
                    CHAOSMONKEY
                  </h1>
                </div>
              </div>
            </div>
          </div>
          <div class="col-12 col-md-4 text-start text-md-end">
            <div class="px-3 px-md-4 pb-3 pb-md-0 d-flex align-items-center justify-content-md-end gap-3">
              <NavUserAvatar />
              <button @click="handleLogout" class="btn btn-light btn-lg">
                <i class="bi bi-box-arrow-right me-2"></i>Logout
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Main Content -->
    <div class="container-fluid py-4">
      <div class="row justify-content-center">
        <div class="col-12" style="max-width: 1200px;">
          
          <!-- Settings Navigation -->
          <div class="card border-0 shadow-sm mb-4">
            <div class="card-body p-4">
              <div class="row">
                <div class="col-md-3">
                  <div class="settings-nav">
                    <div class="nav flex-column nav-pills">
                      <a
                        href="#"
                        class="nav-link"
                        @click.prevent="setTab('profile')"
                        :class="{ active: activeTab === 'profile' }"
                      >
                        <i class="bi bi-person me-2"></i>Profile
                      </a>
                      <a
                        href="#"
                        class="nav-link"
                        @click.prevent="setTab('team')"
                        :class="{ active: activeTab === 'team' }"
                      >
                        <i class="bi bi-people me-2"></i>Team
                      </a>
                      <a
                        href="#"
                        class="nav-link"
                        @click.prevent="setTab('operator')"
                        :class="{ active: activeTab === 'operator' }"
                      >
                        <i class="bi bi-activity me-2"></i>Pilot Health
                      </a>
                      <!-- Nonfunctional settings tabs are hidden from nav.
                           Direct-URL access redirects to profile with unavailable notice. -->
                      <a
                        v-if="false"
                        href="#"
                        class="nav-link"
                        @click.prevent="setTab('notifications')"
                        :class="{ active: activeTab === 'notifications' }"
                      >
                        <i class="bi bi-bell me-2"></i>Notifications
                      </a>
                      <a
                        v-if="false"
                        href="#"
                        class="nav-link"
                        @click.prevent="setTab('security')"
                        :class="{ active: activeTab === 'security' }"
                      >
                        <i class="bi bi-shield-lock me-2"></i>Security
                      </a>
                      <a
                        v-if="false"
                        href="#"
                        class="nav-link"
                        @click.prevent="setTab('billing')"
                        :class="{ active: activeTab === 'billing' }"
                      >
                        <i class="bi bi-credit-card me-2"></i>Manage Billing
                      </a>
                      <a
                        href="#"
                        class="nav-link"
                        @click.prevent="setTab('integrations')"
                        :class="{ active: activeTab === 'integrations' }"
                      >
                        <i class="bi bi-link-45deg me-2"></i>Integrations
                      </a>
                      <a
                        v-if="false"
                        href="#"
                        class="nav-link"
                        @click.prevent="setTab('preferences')"
                        :class="{ active: activeTab === 'preferences' }"
                      >
                        <i class="bi bi-gear me-2"></i>Preferences
                      </a>
                    </div>
                  </div>
                </div>
                <div class="col-md-9">
                  <div class="settings-content">
                    
                    <!-- Profile Settings -->
                    <div v-if="activeTab === 'profile'" class="settings-section">
                      <h3 class="h4 mb-4">Profile Settings</h3>
                      
                      <div class="card mb-4">
                        <div class="card-body">
                          <h5 class="card-title mb-3">Personal & Organization Information</h5>
                          <form @submit.prevent="updateProfile">
                            <div class="row g-3">
                              <div class="col-md-6">
                                <label for="firstName" class="form-label">First Name</label>
                                <input 
                                  v-model="profileForm.firstName" 
                                  type="text" 
                                  class="form-control" 
                                  id="firstName"
                                  :class="{ 'is-invalid': profileFormErrors.firstName }"
                                >
                                <div v-if="profileFormErrors.firstName" class="invalid-feedback">
                                  {{ profileFormErrors.firstName }}
                                </div>
                              </div>
                              <div class="col-md-6">
                                <label for="lastName" class="form-label">Last Name</label>
                                <input 
                                  v-model="profileForm.lastName" 
                                  type="text" 
                                  class="form-control" 
                                  id="lastName"
                                  :class="{ 'is-invalid': profileFormErrors.lastName }"
                                >
                                <div v-if="profileFormErrors.lastName" class="invalid-feedback">
                                  {{ profileFormErrors.lastName }}
                                </div>
                              </div>
                              <div class="col-12">
                                <label for="email" class="form-label">Email Address</label>
                                <input 
                                  v-model="profileForm.email" 
                                  type="email" 
                                  class="form-control" 
                                  id="email"
                                  :class="{ 'is-invalid': profileFormErrors.email }"
                                >
                                <div v-if="profileFormErrors.email" class="invalid-feedback">
                                  {{ profileFormErrors.email }}
                                </div>
                              </div>
                              <div class="col-md-6">
                                <label class="form-label">Organization</label>
                                <div class="form-control-plaintext fw-semibold">
                                  <i class="bi bi-building me-2"></i>
                                  {{ organizationInfo.name || 'Loading...' }}
                                </div>
                              </div>
                              <div class="col-md-6">
                                <label class="form-label">Your Role</label>
                                <div class="form-control-plaintext">
                                  <span class="badge" :class="getRoleBadgeClass(userInfo.role)">
                                    <i :class="getRoleIcon(userInfo.role)" class="me-1"></i>
                                    {{ userInfo.role || 'Loading...' }}
                                  </span>
                                </div>
                              </div>
                              <div class="col-12">
                                <label for="bio" class="form-label">Bio</label>
                                <textarea 
                                  v-model="profileForm.bio" 
                                  class="form-control" 
                                  id="bio"
                                  rows="3"
                                  placeholder="Tell us about yourself..."
                                  :class="{ 'is-invalid': profileFormErrors.bio }"
                                ></textarea>
                                <div v-if="profileFormErrors.bio" class="invalid-feedback">
                                  {{ profileFormErrors.bio }}
                                </div>
                              </div>
                              <div class="col-12">
                                <label class="form-label">Organization ID</label>
                                <div class="form-control-plaintext text-muted small">
                                  {{ organizationInfo.id || 'Loading...' }}
                                </div>
                              </div>
                              <div class="col-12">
                                <button 
                                  type="submit" 
                                  class="btn btn-primary"
                                  :disabled="loadingStates[getLoadingKey('profile')]"
                                >
                                  <span v-if="loadingStates[getLoadingKey('profile')]" class="spinner-border spinner-border-sm me-2"></span>
                                  Save Changes
                                </button>
                              </div>
                            </div>
                          </form>
                        </div>
                      </div>
                    </div>

                    <!-- Team Management -->
                    <div v-if="activeTab === 'team'" class="settings-section">
                      <h3 class="h4 mb-4">Team Management</h3>

                      <!-- Shared loading/error states -->
                      <div v-if="isLoadingTeam" class="text-center py-4">
                        <div class="spinner-border text-primary" role="status">
                          <span class="visually-hidden">Loading team...</span>
                        </div>
                        <p class="mt-2 text-muted">Loading team...</p>
                      </div>

                      <div v-else-if="teamLoadError === 'session_expired'" class="text-center py-4">
                        <i class="bi bi-lock text-muted" style="font-size: 3rem;"></i>
                        <h5 class="text-muted mt-3">Your session has expired</h5>
                        <p class="text-muted">Sign in again to manage your team.</p>
                        <button @click="handleSessionExpired" class="btn btn-primary mt-2">
                          <i class="bi bi-box-arrow-in-right me-2"></i>Sign in
                        </button>
                      </div>

                      <div v-else-if="teamLoadError === 'load_failed' && visibleTeamMembers.length === 0" class="text-center py-4">
                        <i class="bi bi-exclamation-triangle text-muted" style="font-size: 3rem;"></i>
                        <h5 class="text-muted mt-3">Team could not be loaded</h5>
                        <p class="text-muted">Please retry.</p>
                        <button @click="fetchOrganizationData" class="btn btn-outline-primary mt-2">
                          <i class="bi bi-arrow-clockwise me-2"></i>Retry
                        </button>
                      </div>

                      <div v-else>
                        <div v-if="teamLoadError === 'load_failed'" class="alert alert-warning mb-3 d-flex align-items-center justify-content-between">
                          <span>Team data could not be fully loaded. Please retry.</span>
                          <button @click="fetchOrganizationData" class="btn btn-sm btn-outline-primary ms-3">
                            <i class="bi bi-arrow-clockwise me-1"></i>Retry
                          </button>
                        </div>

                        <!-- Section 1: Developer Enrollments (primary pilot-rollout job) -->
                        <div class="card mb-4">
                          <div class="card-body">
                            <h5 class="card-title mb-1">Developer Enrollments</h5>
                            <p class="text-muted small mb-3">
                              Developers enrolled to send telemetry. Each has a personal enrollment credential for the supported clients — IDE extension (VS Code / Cursor / Devin), Claude Code, and Codex. Dashboard login is not required.
                            </p>

                            <!-- Create developer enrollment (above roster so admins don't scroll past 20+ developers) -->
                            <div class="card mb-3">
                              <div class="card-body">
                                <h6 class="card-title mb-2">Create developer enrollment</h6>
                                <p class="text-muted small mb-3">
                                  Create an enrollment for each developer. Each developer gets their own identity and enrollment code. Do not share one code across multiple developers.
                                </p>

                                <div v-if="enrollmentAlert.show" class="alert" :class="`alert-${enrollmentAlert.type}`" role="alert">
                                  {{ enrollmentAlert.message }}
                                </div>

                                <div class="d-flex align-items-center gap-2 flex-wrap">
                                  <div class="flex-grow-1" style="min-width: 240px;">
                                    <input
                                      v-model="newDeveloperEmail"
                                      type="email"
                                      class="form-control"
                                      :class="{ 'is-invalid': newDeveloperEmailError }"
                                      placeholder="developer@company.com"
                                      @keydown.enter.prevent="createDeveloperEnrollment"
                                      :disabled="isCreatingEnrollment"
                                    >
                                    <div v-if="newDeveloperEmailError" class="invalid-feedback">
                                      {{ newDeveloperEmailError }}
                                    </div>
                                  </div>
                                  <button
                                    @click="createDeveloperEnrollment"
                                    :disabled="isCreatingEnrollment"
                                    class="btn btn-primary text-nowrap"
                                  >
                                    <span v-if="isCreatingEnrollment" class="spinner-border spinner-border-sm me-2"></span>
                                    <span v-if="isCreatingEnrollment">Creating...</span>
                                    <span v-else><i class="bi bi-person-plus me-1"></i>Create developer enrollment</span>
                                  </button>
                                </div>

                                <div v-if="isAdmin && activeCohorts.length > 0" class="d-flex align-items-center gap-2 mt-2">
                                  <label for="enrollCohort" class="form-label small text-muted mb-0 text-nowrap">Cohort (optional)</label>
                                  <select id="enrollCohort" v-model="enrollCohortId" class="form-select form-select-sm" style="max-width: 260px;">
                                    <option value="">None</option>
                                    <option v-for="c in activeCohorts" :key="c.id" :value="String(c.id)">{{ c.name }}</option>
                                  </select>
                                </div>

                                <p class="text-muted small mt-2 mb-0">
                                  The email identifies the developer on your roster — no email is sent. After creating the enrollment, click "Generate code", then "Copy setup instructions" to share with the developer.
                                </p>

                                <div v-if="isAdmin" class="border-top pt-3 mt-3">
                                  <div class="d-flex align-items-start justify-content-between gap-2 flex-wrap">
                                    <div>
                                      <h6 class="card-title mb-1">Roll out to multiple developers</h6>
                                      <p class="text-muted small mb-0">
                                        Paste a team list and generate one shared enrollment link for the batch.
                                      </p>
                                    </div>
                                    <button
                                      type="button"
                                      class="btn btn-sm btn-outline-secondary text-nowrap"
                                      :aria-expanded="bulkRolloutOpen"
                                      @click="bulkRolloutOpen = !bulkRolloutOpen"
                                    >
                                      <i :class="bulkRolloutOpen ? 'bi-chevron-up' : 'bi-people'" class="me-1"></i>
                                      {{ bulkRolloutOpen ? 'Hide multiple developers' : 'Add multiple developers' }}
                                    </button>
                                  </div>

                                  <div v-if="bulkRolloutOpen" class="mt-3">
                                    <div v-if="bulkRolloutAlert.show" class="alert mb-3" :class="`alert-${bulkRolloutAlert.type}`" role="alert">
                                      {{ bulkRolloutAlert.message }}
                                      <div v-if="bulkRolloutFailureSummary" class="small mt-2">
                                        Backend result: {{ bulkRolloutFailureSummary.requested }} requested ·
                                        {{ bulkRolloutFailureSummary.created }} created ·
                                        {{ bulkRolloutFailureSummary.reused }} reused ·
                                        {{ bulkRolloutFailureSummary.skipped }} skipped ·
                                        {{ bulkRolloutFailureSummary.failed }} failed
                                      </div>
                                    </div>

                                    <template v-if="!bulkRolloutResult">
                                      <label for="bulkDeveloperEmails" class="form-label small fw-semibold">Developer emails</label>
                                      <textarea
                                        id="bulkDeveloperEmails"
                                        v-model="bulkEmailsText"
                                        class="form-control font-monospace small"
                                        :class="{ 'is-invalid': bulkRolloutError }"
                                        rows="5"
                                        placeholder="dev1@company.com&#10;dev2@company.com&#10;dev3@company.com, dev4@company.com; dev5@company.com"
                                        :disabled="isCreatingBulkRollout"
                                      ></textarea>
                                      <div v-if="bulkRolloutError" class="invalid-feedback d-block">
                                        {{ bulkRolloutError }}
                                      </div>

                                      <div class="d-flex justify-content-between align-items-start gap-2 flex-wrap mt-2">
                                        <div class="small text-muted">
                                          {{ bulkInputSummary.entered }} entered ·
                                          {{ bulkInputSummary.emails.length }} unique valid ·
                                          {{ bulkInputSummary.duplicateCount }} duplicate{{ bulkInputSummary.duplicateCount === 1 ? '' : 's' }} ·
                                          {{ bulkInputSummary.malformedEntries.length }} malformed
                                        </div>
                                        <div class="small text-muted">Up to {{ BULK_ROLLOUT_MAX_EMAILS }} unique valid emails</div>
                                      </div>
                                      <div v-if="bulkInputSummary.malformedEntries.length" class="small text-warning mt-1">
                                        Malformed: {{ bulkInputSummary.malformedEntries.join(', ') }}
                                      </div>

                                      <!-- K1B: optional cohort for the whole rollout batch -->
                                      <div v-if="activeCohorts.length > 0" class="d-flex align-items-center gap-2 mt-3">
                                        <label for="bulkCohort" class="form-label small text-muted mb-0 text-nowrap">Cohort (optional)</label>
                                        <select id="bulkCohort" v-model="bulkCohortId" class="form-select form-select-sm" style="max-width: 260px;" :disabled="isCreatingBulkRollout">
                                          <option value="">None</option>
                                          <option v-for="c in activeCohorts" :key="c.id" :value="String(c.id)">{{ c.name }}</option>
                                        </select>
                                      </div>

                                      <button
                                        type="button"
                                        class="btn btn-primary mt-3"
                                        :disabled="isCreatingBulkRollout"
                                        @click="createBulkRollout"
                                      >
                                        <span v-if="isCreatingBulkRollout" class="spinner-border spinner-border-sm me-2"></span>
                                        <span v-if="isCreatingBulkRollout">Generating rollout link...</span>
                                        <span v-else><i class="bi bi-link-45deg me-1"></i>Generate shared rollout link</span>
                                      </button>
                                    </template>

                                    <div v-else class="alert alert-success mb-0" role="alert">
                                      <h6 class="alert-heading mb-2"><i class="bi bi-check-circle me-1"></i>Shared rollout link created</h6>
                                      <p class="small mb-2">
                                        Give this one enrollment link to the developers in this rollout. Each developer will enter the work email you included.
                                        Copy and save it now — it is not shown again later.
                                      </p>
                                      <div class="d-flex align-items-stretch gap-2 flex-wrap">
                                        <pre class="form-control bg-dark text-light font-monospace small mb-0 flex-grow-1" style="white-space: pre-wrap; overflow-wrap: anywhere;">{{ bulkRolloutResult.rollout_url }}</pre>
                                        <button
                                          type="button"
                                          class="btn btn-outline-light text-nowrap"
                                          @click="copyBulkRolloutLink"
                                        >
                                          <i class="bi bi-clipboard me-1"></i>Copy rollout link
                                        </button>
                                      </div>
                                      <div class="small mt-3">
                                        Backend result: {{ bulkRolloutResult.summary.requested }} requested ·
                                        {{ bulkRolloutResult.summary.created }} created ·
                                        {{ bulkRolloutResult.summary.reused }} reused ·
                                        {{ bulkRolloutResult.summary.skipped }} skipped ·
                                        {{ bulkRolloutResult.summary.failed }} failed
                                      </div>
                                      <!-- K1B: authoritative cohort assignment confirmation -->
                                      <div v-if="bulkRolloutResult.cohort" class="small mt-1">
                                        Cohort: {{ bulkRolloutResult.cohort.name }} — {{ bulkRolloutResult.cohort.assigned_count }} assigned
                                      </div>
                                      <button
                                        type="button"
                                        class="btn btn-sm btn-outline-secondary mt-3"
                                        @click="resetBulkRollout"
                                      >
                                        Start another rollout
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>

                            <!-- K1B: Developer cohorts — organization-scoped groups for
                                 analytics filtering. Membership is server-authoritative
                                 and attaches to the invite-backed enrollment identity. -->
                            <div class="card mb-3">
                              <div class="card-body">
                                <h6 class="card-title mb-1">Developer cohorts</h6>
                                <p class="text-muted small mb-3">
                                  Cohorts group developer enrollments for analytics filtering. A developer belongs to at most one cohort. Metrics use current cohort membership across the selected period.
                                </p>

                                <div v-if="cohortAlert.show" class="alert" :class="`alert-${cohortAlert.type}`" role="alert">
                                  {{ cohortAlert.message }}
                                </div>

                                <div v-if="cohortsLoadError" class="text-muted small mb-2">
                                  <i class="bi bi-exclamation-circle me-1"></i>
                                  {{ cohortsLoadError === 'session_expired' ? 'Session expired — cohorts could not be loaded.' : 'Cohorts could not be loaded.' }}
                                </div>

                                <!-- Create cohort (admin only) -->
                                <div v-if="isAdmin" class="d-flex align-items-center gap-2 flex-wrap mb-3">
                                  <input
                                    v-model="newCohortName"
                                    type="text"
                                    class="form-control"
                                    style="max-width: 240px;"
                                    placeholder="Cohort name (e.g. Platform pilot)"
                                    @keydown.enter.prevent="createCohort"
                                    :disabled="isCreatingCohort"
                                  >
                                  <input
                                    v-model="newCohortDescription"
                                    type="text"
                                    class="form-control"
                                    style="max-width: 280px;"
                                    placeholder="Description (optional)"
                                    :disabled="isCreatingCohort"
                                  >
                                  <button
                                    type="button"
                                    class="btn btn-outline-primary text-nowrap"
                                    :disabled="isCreatingCohort || !newCohortName.trim()"
                                    @click="createCohort"
                                  >
                                    <span v-if="isCreatingCohort" class="spinner-border spinner-border-sm me-1"></span>
                                    <i v-else class="bi bi-plus-lg me-1"></i>Create cohort
                                  </button>
                                </div>

                                <!-- Active cohorts -->
                                <div v-if="activeCohorts.length > 0" class="list-group list-group-flush">
                                  <div
                                    v-for="cohort in activeCohorts"
                                    :key="cohort.id"
                                    class="list-group-item px-0 py-2"
                                  >
                                    <div class="d-flex align-items-center gap-2 flex-wrap">
                                      <template v-if="editingCohortId === cohort.id">
                                        <input
                                          v-model="editingCohortName"
                                          type="text"
                                          class="form-control form-control-sm"
                                          style="max-width: 220px;"
                                          @keydown.enter.prevent="renameCohort(cohort)"
                                          @keydown.esc.prevent="cancelEditCohort"
                                        >
                                        <button type="button" class="btn btn-sm btn-primary" @click="renameCohort(cohort)">Save</button>
                                        <button type="button" class="btn btn-sm btn-outline-secondary" @click="cancelEditCohort">Cancel</button>
                                      </template>
                                      <template v-else>
                                        <span class="fw-semibold">{{ cohort.name }}</span>
                                        <span class="badge bg-light text-dark border">{{ cohort.member_count }} member{{ cohort.member_count === 1 ? '' : 's' }}</span>
                                        <span v-if="cohort.description" class="text-muted small text-truncate" style="max-width: 260px;">{{ cohort.description }}</span>
                                      </template>
                                      <span class="flex-grow-1"></span>
                                      <button
                                        type="button"
                                        class="btn btn-sm btn-outline-secondary text-nowrap"
                                        @click="loadCohortMembers(cohort)"
                                      >
                                        <i :class="expandedCohortId === cohort.id ? 'bi-chevron-up' : 'bi-list-ul'" class="me-1"></i>
                                        {{ expandedCohortId === cohort.id ? 'Hide members' : 'Members' }}
                                      </button>
                                      <template v-if="isAdmin">
                                        <button
                                          v-if="editingCohortId !== cohort.id"
                                          type="button"
                                          class="btn btn-sm btn-outline-secondary text-nowrap"
                                          @click="startEditCohort(cohort)"
                                        >
                                          <i class="bi bi-pencil me-1"></i>Rename
                                        </button>
                                        <button
                                          type="button"
                                          class="btn btn-sm btn-outline-danger text-nowrap"
                                          @click="archiveCohort(cohort)"
                                        >
                                          <i class="bi bi-archive me-1"></i>Archive
                                        </button>
                                      </template>
                                    </div>
                                    <div v-if="expandedCohortId === cohort.id" class="mt-2 ps-3 border-start">
                                      <div v-if="cohortMembersLoading" class="text-muted small">Loading members…</div>
                                      <template v-else>
                                        <div v-if="(cohortMembers[cohort.id] || []).length === 0" class="text-muted small">
                                          No members — assign enrollments from the roster below.
                                        </div>
                                        <div
                                          v-for="m in cohortMembers[cohort.id] || []"
                                          :key="m.invite_id"
                                          class="d-flex align-items-center gap-2 py-1 small"
                                        >
                                          <i class="bi bi-code-slash text-muted"></i>
                                          <span class="text-truncate">{{ m.email || m.name || `Invite #${m.invite_id}` }}</span>
                                          <span class="flex-grow-1"></span>
                                          <button
                                            v-if="isAdmin"
                                            type="button"
                                            class="btn btn-sm btn-link text-danger p-0"
                                            @click="setMemberCohort({ invite_id: m.invite_id, cohort_id: cohort.id, email: m.email }, '')"
                                          >
                                            Remove
                                          </button>
                                        </div>
                                      </template>
                                    </div>
                                  </div>
                                </div>
                                <div v-else class="text-muted small">
                                  No active cohorts{{ isAdmin ? ' — create one above to start grouping developers' : '' }}.
                                </div>

                                <!-- Archived cohorts (retained history, not selectable) -->
                                <div v-if="archivedCohorts.length > 0" class="mt-3">
                                  <div class="small text-muted fw-semibold mb-1">Archived</div>
                                  <div
                                    v-for="cohort in archivedCohorts"
                                    :key="cohort.id"
                                    class="d-flex align-items-center gap-2 py-1 small text-muted"
                                  >
                                    <i class="bi bi-archive"></i>
                                    <span>{{ cohort.name }}</span>
                                    <span class="badge bg-secondary-subtle text-secondary border">{{ cohort.member_count }} member{{ cohort.member_count === 1 ? '' : 's' }}</span>
                                  </div>
                                </div>
                              </div>
                            </div>

                            <!-- Developer enrollment roster -->
                            <div v-if="developerEnrollments.length > 0">
                              <!-- Header row -->
                              <div class="d-flex align-items-center gap-2 px-2 py-1 border-bottom fw-semibold small text-muted">
                                <div style="flex: 1 1 160px; min-width: 120px;">Developer</div>
                                <div style="flex: 0 0 90px;">Enrollment</div>
                                <div style="flex: 1 1 180px; min-width: 140px;">Connection</div>
                                <div style="flex: 0 0 150px;">Cohort</div>
                                <div v-if="isAdmin" style="flex: 0 0 130px;">Actions</div>
                              </div>
                              <!-- Enrollment rows -->
                              <div
                                v-for="member in developerEnrollments"
                                :key="member.invite_id"
                                class="d-flex align-items-start gap-2 px-2 py-2 border-bottom"
                              >
                                <!-- Developer identity (flexes/shrinks) -->
                                <div style="flex: 1 1 160px; min-width: 120px;" class="d-flex align-items-center fw-semibold">
                                  <i class="bi bi-code-slash me-2 text-muted flex-shrink-0"></i>
                                  <span class="text-truncate">{{ member.email || member.name || 'Unknown developer' }}</span>
                                </div>
                                <!-- Enrollment status -->
                                <div style="flex: 0 0 90px;">
                                  <span
                                    class="badge"
                                    :class="memberStatusBadgeClass(member)"
                                  >
                                    <i :class="memberStatusIcon(member)" class="me-1"></i>
                                    {{ memberStatusLabel(member) }}
                                  </span>
                                </div>
                                <!-- Connection -->
                                <div style="flex: 1 1 180px; min-width: 140px;" class="d-flex flex-column">
                                  <div v-if="visibleCodes[member.invite_id]" class="font-monospace small text-nowrap" style="max-width: 220px; white-space: nowrap; overflow: visible;">
                                    {{ visibleCodes[member.invite_id] }}
                                  </div>
                                  <div v-else-if="member.connect_code_revoked" class="text-danger small">
                                    <i class="bi bi-slash-circle me-1"></i>Code revoked
                                  </div>
                                  <div v-else-if="member.connect_code_expired" class="text-danger small">
                                    <i class="bi bi-exclamation-triangle-fill me-1"></i>Code expired
                                  </div>
                                  <div v-else-if="member.has_connect_code" class="text-muted small">Generated</div>
                                  <div v-else class="text-muted small">Not generated</div>
                                  <div v-if="member.enrollment_status === 'connected'" class="small text-success mt-1">
                                    <i class="bi bi-plug-fill me-1"></i>{{ member.installation_count }} installation{{ member.installation_count === 1 ? '' : 's' }} connected
                                  </div>
                                  <button
                                    v-if="visibleCodes[member.invite_id]"
                                    @click="copySetupInstructions(member)"
                                    class="btn btn-sm btn-outline-primary mt-1 text-nowrap align-self-start"
                                    style="white-space: nowrap;"
                                  >
                                    <i class="bi bi-clipboard me-1"></i>Copy setup instructions
                                  </button>
                                  <button
                                    v-if="visibleCodes[member.invite_id]"
                                    @click="hideConnectCode(member)"
                                    class="btn btn-sm btn-outline-secondary mt-1 text-nowrap align-self-start"
                                    style="white-space: nowrap;"
                                  >
                                    <i class="bi bi-eye-slash me-1"></i>Hide code
                                  </button>
                                  <button
                                    v-if="!visibleCodes[member.invite_id] && member.has_connect_code && !member.connect_code_expired && !member.connect_code_revoked"
                                    @click="showConnectCode(member)"
                                    class="btn btn-sm btn-outline-primary mt-1 text-nowrap align-self-start"
                                    style="white-space: nowrap;"
                                  >
                                    <i class="bi bi-eye me-1"></i>Show code
                                  </button>
                                  <button
                                    v-if="!visibleCodes[member.invite_id] && !member.has_connect_code"
                                    @click="generateConnectCode(member)"
                                    class="btn btn-sm btn-outline-primary mt-1 text-nowrap align-self-start"
                                    style="white-space: nowrap;"
                                  >
                                    Generate code
                                  </button>
                                  <button
                                    v-if="member.connect_code_expired || member.connect_code_revoked"
                                    @click="generateConnectCode(member)"
                                    class="btn btn-sm btn-outline-danger mt-1 text-nowrap align-self-start"
                                    style="white-space: nowrap;"
                                  >
                                    <i class="bi bi-arrow-repeat me-1"></i>Regenerate code
                                  </button>
                                </div>
                                <!-- Cohort (K1B: server-authoritative membership on the invite identity) -->
                                <div style="flex: 0 0 150px;">
                                  <select
                                    v-if="isAdmin"
                                    class="form-select form-select-sm"
                                    :value="member.cohort_id ? String(member.cohort_id) : ''"
                                    @change="setMemberCohort(member, $event.target.value)"
                                  >
                                    <option value="">Unassigned</option>
                                    <option v-for="c in activeCohorts" :key="c.id" :value="String(c.id)">{{ c.name }}</option>
                                    <option v-if="member.cohort_id && !activeCohorts.some(c => String(c.id) === String(member.cohort_id))" :value="String(member.cohort_id)" disabled>
                                      {{ member.cohort_name || 'Archived cohort' }}
                                    </option>
                                  </select>
                                  <span v-else class="small text-muted">{{ member.cohort_name || 'Unassigned' }}</span>
                                </div>
                                <!-- Actions -->
                                <div v-if="isAdmin" style="flex: 0 0 130px;">
                                  <div v-if="member.enrollment_status !== 'connected'" class="d-flex flex-column gap-1">
                                    <button
                                      @click="cancelInvite(member)"
                                      class="btn btn-sm btn-outline-danger text-nowrap"
                                    >
                                      <i class="bi bi-x-circle me-1"></i>Cancel enrollment
                                    </button>
                                  </div>
                                </div>
                              </div>
                            </div>
                            <div v-else class="text-center py-3">
                              <i class="bi bi-code-slash text-muted" style="font-size: 2.5rem;"></i>
                              <p class="text-muted mt-2 mb-0">No developer enrollments yet</p>
                            </div>
                          </div>
                        </div>

                        <!-- Section 2: Dashboard Users (secondary administrative capability) -->
                        <div class="card mb-4">
                          <div class="card-body">
                            <h5 class="card-title mb-1">Dashboard Users</h5>
                            <p class="text-muted small mb-3">
                              Users who can sign in to this dashboard to view metrics and manage the organization. Dashboard access is separate from developer telemetry enrollment.
                            </p>

                            <div v-if="dashboardMembers.length > 0" class="table-responsive">
                              <table class="table table-hover align-middle">
                                <thead>
                                  <tr>
                                    <th class="col-4">Member</th>
                                    <th class="col-2">Role</th>
                                    <th class="col-2">Status</th>
                                    <th class="col-4" v-if="isAdmin">Actions</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  <tr
                                    v-for="member in dashboardMembers"
                                    :key="member.id"
                                    :class="{ 'table-active': member.id === userInfo.id }"
                                  >
                                    <td>
                                      <div class="d-flex flex-column justify-content-center">
                                        <div class="d-flex align-items-center fw-semibold" style="min-height: 1.5rem;">
                                          <i class="bi bi-person-circle me-2 text-muted"></i>
                                          <span>{{ member.name }}</span>
                                          <span
                                            v-if="member.id === userInfo.id"
                                            class="badge bg-primary ms-2"
                                          >
                                            You
                                          </span>
                                        </div>
                                        <div class="small text-muted" style="min-height: 1.25rem;">
                                          {{ member.email || 'No email' }}
                                        </div>
                                      </div>
                                    </td>
                                    <td>
                                      <span class="badge" :class="getRoleBadgeClass(member.role)">
                                        <i :class="getRoleIcon(member.role)" class="me-1"></i>
                                        {{ member.role || 'member' }}
                                      </span>
                                    </td>
                                    <td>
                                      <span
                                        class="badge"
                                        :class="memberStatusBadgeClass(member)"
                                      >
                                        <i :class="memberStatusIcon(member)" class="me-1"></i>
                                        {{ memberStatusLabel(member) }}
                                      </span>
                                    </td>
                                    <td v-if="isAdmin">
                                      <div class="d-flex flex-column gap-1" v-if="member.id !== userInfo.id">
                                        <button
                                          v-if="(member.role || 'member') !== 'admin'"
                                          @click="promoteMember(member)"
                                          class="btn btn-sm btn-outline-success text-nowrap"
                                        >
                                          <i class="bi bi-shield-plus me-1"></i>Promote
                                        </button>
                                        <button
                                          v-else
                                          @click="demoteMember(member)"
                                          class="btn btn-sm btn-outline-warning text-nowrap"
                                        >
                                          <i class="bi bi-shield-minus me-1"></i>Demote
                                        </button>
                                        <button
                                          @click="removeMember(member)"
                                          class="btn btn-sm btn-outline-danger text-nowrap"
                                        >
                                          <i class="bi bi-person-x me-1"></i>Remove
                                        </button>
                                      </div>
                                    </td>
                                  </tr>
                                </tbody>
                              </table>
                            </div>
                            <div v-else class="text-center py-3">
                              <i class="bi bi-people text-muted" style="font-size: 2.5rem;"></i>
                              <p class="text-muted mt-2 mb-0">No dashboard users yet</p>
                            </div>

                            <!-- Pending dashboard-user invites with recovery actions -->
                            <div v-if="pendingDashboardInvites.length > 0" class="mt-3">
                              <h6 class="text-muted small mb-2">
                                <i class="bi bi-hourglass-split me-1"></i>Pending invitations
                              </h6>
                              <div
                                v-for="inv in pendingDashboardInvites"
                                :key="`dash-inv-${inv.invite_id}`"
                                class="d-flex align-items-center gap-2 py-2 border-top flex-wrap"
                              >
                                <span class="text-truncate fw-semibold" style="min-width: 180px; flex: 1 1 auto;">
                                  {{ inv.email }}
                                </span>
                                <span class="badge" :class="getRoleBadgeClass(inv.role)">
                                  <i :class="getRoleIcon(inv.role)" class="me-1"></i>{{ inv.role || 'member' }}
                                </span>
                                <span class="badge bg-secondary">Pending</span>
                                <div v-if="isAdmin" class="d-flex gap-1 flex-wrap ms-auto">
                                  <button
                                    @click="copyPendingInviteLink(inv)"
                                    class="btn btn-sm btn-outline-primary text-nowrap"
                                    title="Copy the existing acceptance link"
                                  >
                                    <i class="bi bi-link-45deg me-1"></i>Copy invite link
                                  </button>
                                  <button
                                    @click="reissueDashInvite(inv)"
                                    class="btn btn-sm btn-outline-secondary text-nowrap"
                                    title="Generate a new link — the previous one stops working"
                                  >
                                    <i class="bi bi-arrow-repeat me-1"></i>Reissue invite
                                  </button>
                                  <button
                                    @click="cancelInvite(inv)"
                                    class="btn btn-sm btn-outline-danger text-nowrap"
                                  >
                                    <i class="bi bi-x-circle me-1"></i>Cancel
                                  </button>
                                </div>
                              </div>
                              <p class="text-muted small mt-1 mb-0">
                                Lost an invite link? Use <strong>Copy invite link</strong> to retrieve it, or
                                <strong>Reissue invite</strong> to invalidate the old link and create a fresh one.
                              </p>
                            </div>

                            <!-- Dashboard user invite (admin only) -->
                            <div v-if="isAdmin" class="card mt-3">
                              <div class="card-body">
                                <h6 class="card-title mb-2">Invite dashboard user</h6>
                                <p class="text-muted small mb-3">
                                  Invite a new dashboard user to your organization. They will receive a link to set their own password.
                                </p>

                                <div v-if="dashInviteAlert.show" class="alert" :class="`alert-${dashInviteAlert.type}`" role="alert">
                                  {{ dashInviteAlert.message }}
                                </div>

                                <div class="d-flex align-items-center gap-2 flex-wrap">
                                  <div style="min-width: 240px; flex-grow: 1;">
                                    <input
                                      v-model="dashInviteEmail"
                                      type="email"
                                      class="form-control"
                                      :class="{ 'is-invalid': dashInviteError }"
                                      placeholder="admin@company.com"
                                      :disabled="isCreatingDashInvite"
                                    >
                                    <div v-if="dashInviteError" class="invalid-feedback">
                                      {{ dashInviteError }}
                                    </div>
                                  </div>
                                  <select
                                    v-model="dashInviteRole"
                                    class="form-select"
                                    style="width: auto;"
                                    :disabled="isCreatingDashInvite"
                                  >
                                    <option value="member">Member</option>
                                    <option value="admin">Admin</option>
                                  </select>
                                  <button
                                    @click="createDashInvite"
                                    :disabled="isCreatingDashInvite"
                                    class="btn btn-primary text-nowrap"
                                  >
                                    <span v-if="isCreatingDashInvite" class="spinner-border spinner-border-sm me-2"></span>
                                    <span v-if="isCreatingDashInvite">Creating...</span>
                                    <span v-else><i class="bi bi-person-plus me-1"></i>Create invite</span>
                                  </button>
                                </div>

                                <div v-if="dashInviteLink" class="mt-3 d-flex align-items-center gap-2 flex-wrap">
                                  <div class="input-group" style="flex-grow: 1; min-width: 300px;">
                                    <input
                                      :value="dashInviteLink"
                                      readonly
                                      class="form-control font-monospace small"
                                    >
                                    <button
                                      @click="copyDashInviteLink"
                                      class="btn btn-outline-secondary"
                                    >
                                      <i class="bi bi-clipboard me-1"></i>Copy link
                                    </button>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>

                    </div>
                    <!-- Pilot Health / Operator -->
                    <div v-if="activeTab === 'operator'" class="settings-section">
                      <PilotHealthPanel />
                    </div>

    <!-- Team Management Modal -->
    <div v-if="teamModal.show" class="modal fade show d-block" tabindex="-1" style="position: fixed; top: 0; left: 0; z-index: 1050; width: 100vw; height: 100vh; background-color: rgba(0, 0, 0, 0.5); display: flex; align-items: center; justify-content: center;" @click="hideTeamModal">
      <div class="modal-dialog modal-dialog-centered" @click.stop>
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">
              <i :class="getModalIcon(teamModal.type)" class="me-2"></i>
              {{ teamModal.title }}
            </h5>
            <button type="button" class="btn-close" @click="hideTeamModal"></button>
          </div>
          <div class="modal-body">
            <p>{{ teamModal.message }}</p>
          </div>
          <div class="modal-footer">
            <button v-if="teamModal.showCancel" type="button" class="btn btn-secondary" @click="handleTeamModalCancel">
              {{ teamModal.cancelText }}
            </button>
            <button type="button" class="btn" :class="getModalButtonClass(teamModal.type)" @click="handleTeamModalConfirm">
              {{ teamModal.confirmText }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Notification Settings -->
                    <div v-if="activeTab === 'notifications'" class="settings-section">
                      <h3 class="h4 mb-4">Notification Settings</h3>
                      
                      <div class="card mb-4">
                        <div class="card-body">
                          <h5 class="card-title mb-3">Email Notifications</h5>
                          <div class="form-check form-switch mb-3">
                            <input 
                              v-model="notificationForm.emailAlerts" 
                              class="form-check-input" 
                              type="checkbox" 
                              id="emailAlerts"
                            >
                            <label class="form-check-label" for="emailAlerts">
                              Receive email alerts for important updates
                            </label>
                          </div>
                          <div class="form-check form-switch mb-3">
                            <input 
                              v-model="notificationForm.weeklyReports" 
                              class="form-check-input" 
                              type="checkbox" 
                              id="weeklyReports"
                            >
                            <label class="form-check-label" for="weeklyReports">
                              Weekly productivity reports
                            </label>
                          </div>
                          <div class="form-check form-switch mb-3">
                            <input 
                              v-model="notificationForm.teamUpdates" 
                              class="form-check-input" 
                              type="checkbox" 
                              id="teamUpdates"
                            >
                            <label class="form-check-label" for="teamUpdates">
                              Team member activity updates
                            </label>
                          </div>
                          <button @click="saveNotifications" class="btn btn-primary" :disabled="loadingStates[getLoadingKey('notifications')]">
                            <span v-if="loadingStates[getLoadingKey('notifications')]" class="spinner-border spinner-border-sm me-2"></span>
                            Save Preferences
                          </button>
                        </div>
                      </div>
                    </div>

                    <!-- Security Settings -->
                    <div v-if="activeTab === 'security'" class="settings-section">
                      <h3 class="h4 mb-4">Security Settings</h3>
                      
                      <div class="card mb-4">
                        <div class="card-body">
                          <h5 class="card-title mb-3">Password</h5>
                          <p class="text-muted mb-3">Change your account password</p>
                          <button @click="showPasswordModal = true" class="btn btn-outline-primary">
                            <i class="bi bi-key me-2"></i>Change Password
                          </button>
                        </div>
                      </div>
                      
                      <div class="card mb-4">
                        <div class="card-body">
                          <h5 class="card-title mb-3">Two-Factor Authentication</h5>
                          <p class="text-muted mb-3">Add an extra layer of security to your account</p>
                          <div class="d-flex align-items-center">
                            <span class="badge bg-secondary me-3">Disabled</span>
                            <button 
                              @click="showTwoFactorModal = true" 
                              class="btn btn-outline-primary"
                              :disabled="loadingStates[getLoadingKey('2fa')]"
                            >
                              <span v-if="loadingStates[getLoadingKey('2fa')]" class="spinner-border spinner-border-sm me-2"></span>
                              Enable 2FA
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>

                    <!-- Integration Settings -->
                    <div v-if="activeTab === 'integrations'" class="settings-section">
                      <h3 class="h4 mb-4">Integration Settings</h3>

                      <!-- CR-X B6: Connect GitHub Engineering Data -->
                      <!-- The legacy static integrations block (GitHub/Slack/Email) was removed
                           because it used hardcoded mock data, not backend authority.
                           Only the GitHub Engineering Data section below uses real OAuth state
                           from /api/github/oauth/status, aligned with Pilot Health authority. -->
                      <div class="card mb-4">
                        <div class="card-body">
                          <h5 class="card-title mb-3">GitHub Engineering Data</h5>
                          <p class="text-muted small mb-3">
                            Connect GitHub to enable engineering evidence (repositories, PRs, commits, deployments, releases).
                            Uses the existing GitHub OAuth flow with engineering-integration scope.
                            Identity-only logins produce zero engineering evidence.
                          </p>
                          <div v-if="githubEngineeringState.loading" class="d-flex align-items-center gap-2">
                            <span class="spinner-border spinner-border-sm"></span>
                            <span>Checking connection state...</span>
                          </div>
                          <div v-else>
                            <div class="mb-3">
                              <span :class="['badge', githubEngineeringState.connected ? 'bg-success' : 'bg-secondary']">
                                {{ githubEngineeringState.connected ? 'GitHub Engineering Data — Connected' : 'Not Connected' }}
                              </span>
                              <span v-if="githubEngineeringState.identityOnly" class="badge bg-warning text-dark ms-2">
                                Identity Only — No Engineering Evidence
                              </span>
                            </div>
                            <p v-if="githubEngineeringState.connected" class="text-success small mb-2">
                              Engineering integration is active. Reconnect to change the authorized GitHub account.
                            </p>
                            <p v-if="githubEngineeringState.connected && !githubEngineeringState.repoAuthority" class="alert alert-warning small mb-2">
                              {{ githubEngineeringState.repoAuthorityMessage }}
                            </p>
                            <button
                              @click="connectGitHubEngineeringData"
                              :class="['btn', githubEngineeringState.connected ? 'btn-outline-primary' : 'btn-primary']"
                              :disabled="githubEngineeringState.connecting"
                            >
                              <span v-if="githubEngineeringState.connecting" class="spinner-border spinner-border-sm me-2"></span>
                              <i class="bi bi-github me-2"></i>
                              {{ githubEngineeringState.connected ? 'Reconnect GitHub Engineering Data' : 'Connect GitHub Engineering Data' }}
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>

                    <!-- Preferences -->
                    <div v-if="activeTab === 'preferences'" class="settings-section">
                      <h3 class="h4 mb-4">Preferences</h3>
                      
                      <div class="card mb-4">
                        <div class="card-body">
                          <h5 class="card-title mb-3">Appearance</h5>
                          <div class="mb-3">
                            <label class="form-label">Theme</label>
                            <select v-model="preferencesForm.theme" class="form-select">
                              <option value="light">Light</option>
                              <option value="dark">Dark</option>
                              <option value="auto">Auto</option>
                            </select>
                          </div>
                          <div class="mb-3">
                            <label class="form-label">Language</label>
                            <select v-model="preferencesForm.language" class="form-select">
                              <option value="en">English</option>
                              <option value="es">Spanish</option>
                              <option value="fr">French</option>
                            </select>
                          </div>
                          <button @click="savePreferences" class="btn btn-primary" :disabled="loadingStates[getLoadingKey('preferences')]">
                            <span v-if="loadingStates[getLoadingKey('preferences')]" class="spinner-border spinner-border-sm me-2"></span>
                            Save Preferences
                          </button>
                        </div>
                      </div>
                    </div>

                    <!-- Billing Management -->
                    <div v-if="activeTab === 'billing'" class="settings-section">
                      <h3 class="h4 mb-4">Manage Billing</h3>
                      
                      <div class="card mb-4">
                        <div class="card-body">
                          <h5 class="card-title mb-3">Current Plan</h5>
                          <div class="row align-items-center">
                            <div class="col-md-8">
                              <div class="d-flex align-items-center mb-3">
                                <div class="me-3">
                                  <h4 class="mb-0 text-primary">Pro Plan</h4>
                                  <p class="text-muted mb-0">$29/month per user</p>
                                </div>
                              </div>
                              <div class="mb-3">
                                <h6>Features Included:</h6>
                                <ul class="list-unstyled">
                                  <li><i class="bi bi-check-circle text-success me-2"></i>Unlimited team members</li>
                                  <li><i class="bi bi-check-circle text-success me-2"></i>Advanced analytics</li>
                                  <li><i class="bi bi-check-circle text-success me-2"></i>GitHub integration</li>
                                  <li><i class="bi bi-check-circle text-success me-2"></i>Priority support</li>
                                </ul>
                              </div>
                            </div>
                            <div class="col-md-4 text-end">
                              <div class="card bg-light">
                                <div class="card-body">
                                  <h6 class="text-muted">Next Billing Date</h6>
                                  <h5 class="text-primary">March 15, 2026</h5>
                                  <button class="btn btn-outline-primary btn-sm w-100 mt-2">
                                    <i class="bi bi-credit-card me-2"></i>Update Payment
                                  </button>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                      
                      <div class="card">
                        <div class="card-body">
                          <h5 class="card-title mb-3">Billing History</h5>
                          <div class="table-responsive">
                            <table class="table table-sm">
                              <thead>
                                <tr>
                                  <th>Date</th>
                                  <th>Description</th>
                                  <th>Amount</th>
                                  <th>Status</th>
                                </tr>
                              </thead>
                              <tbody>
                                <tr v-for="invoice in billingHistory" :key="invoice.id">
                                  <td>{{ invoice.date }}</td>
                                  <td>{{ invoice.description }}</td>
                                  <td>${{ invoice.amount }}</td>
                                  <td>
                                    <span class="badge" :class="getInvoiceStatusClass(invoice.status)">
                                      {{ invoice.status }}
                                    </span>
                                  </td>
                                </tr>
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Change Password Modal -->
    <div v-if="showPasswordModal" class="modal fade show d-block" tabindex="-1">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">Change Password</h5>
            <button type="button" class="btn-close" @click="showPasswordModal = false"></button>
          </div>
          <div class="modal-body">
            <form @submit.prevent="changePassword">
              <div class="mb-3">
                <label for="currentPassword" class="form-label">Current Password</label>
                <input 
                  v-model="passwordForm.currentPassword" 
                  type="password" 
                  class="form-control" 
                  id="currentPassword"
                  :class="{ 'is-invalid': passwordFormErrors.currentPassword }"
                  required
                >
                <div v-if="passwordFormErrors.currentPassword" class="invalid-feedback">
                  {{ passwordFormErrors.currentPassword }}
                </div>
              </div>
              <div class="mb-3">
                <label for="newPassword" class="form-label">New Password</label>
                <input 
                  v-model="passwordForm.newPassword" 
                  type="password" 
                  class="form-control" 
                  id="newPassword"
                  :class="{ 'is-invalid': passwordFormErrors.newPassword }"
                  required
                >
                <div v-if="passwordFormErrors.newPassword" class="invalid-feedback">
                  {{ passwordFormErrors.newPassword }}
                </div>
              </div>
              <div class="mb-3">
                <label for="confirmPassword" class="form-label">Confirm New Password</label>
                <input 
                  v-model="passwordForm.confirmPassword" 
                  type="password" 
                  class="form-control" 
                  id="confirmPassword"
                  :class="{ 'is-invalid': passwordFormErrors.confirmPassword }"
                  required
                >
                <div v-if="passwordFormErrors.confirmPassword" class="invalid-feedback">
                  {{ passwordFormErrors.confirmPassword }}
                </div>
              </div>
            </form>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" @click="showPasswordModal = false">Cancel</button>
            <button 
              type="button" 
              class="btn btn-primary" 
              @click="changePassword"
              :disabled="loadingStates[getLoadingKey('password')]"
            >
              <span v-if="loadingStates[getLoadingKey('password')]" class="spinner-border spinner-border-sm me-2"></span>
              Change Password
            </button>
          </div>
        </div>
      </div>
      <div class="modal-backdrop fade show" @click="showPasswordModal = false"></div>
    </div>

    <!-- Two-Factor Authentication Modal -->
    <div v-if="showTwoFactorModal" class="modal fade show d-block" tabindex="-1">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">Enable Two-Factor Authentication</h5>
            <button type="button" class="btn-close" @click="showTwoFactorModal = false"></button>
          </div>
          <div class="modal-body">
            <div class="text-center mb-4">
              <i class="bi bi-shield-lock display-4 text-primary mb-3"></i>
              <h6>Secure your account with 2FA</h6>
              <p class="text-muted">Two-factor authentication adds an extra layer of security to your account by requiring more than just a password to sign in.</p>
            </div>
            <div class="alert alert-info">
              <i class="bi bi-info-circle me-2"></i>
              You'll need to use an authenticator app like Google Authenticator or Authy to set up 2FA.
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" @click="showTwoFactorModal = false">Cancel</button>
            <button 
              type="button" 
              class="btn btn-primary" 
              @click="enableTwoFactor"
              :disabled="loadingStates[getLoadingKey('2fa')]"
            >
              <span v-if="loadingStates[getLoadingKey('2fa')]" class="spinner-border spinner-border-sm me-2"></span>
              Enable 2FA
            </button>
          </div>
        </div>
      </div>
      <div class="modal-backdrop fade show" @click="showTwoFactorModal = false"></div>
    </div>

    <!-- Integration Toggle Modal -->
  </div>
</template>

<script setup>
import { ref, onMounted, computed, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import NavUserAvatar from '../components/NavUserAvatar.vue'
import PilotHealthPanel from '../components/PilotHealthPanel.vue'
import api, { authenticatedFetch } from '../config/api'
import { API_URL } from '../config/api'
import { buildSetupInstructions, probeCursorAgentBridge } from '../lib/setupInstructions'
import { isLocal } from '../config/environment'
import { isOperatorEnrollmentEmail } from '../lib/operatorIdentities'
import {
  BULK_ROLLOUT_MAX_EMAILS,
  createBulkRolloutHandler,
  parseBulkEnrollmentInput,
} from '../lib/bulkEnrollment'

const router = useRouter()
const route = useRoute()
const authStore = useAuthStore()

// Display-only filter: hide obvious simulated/seed/demo users from team management surfaces
// Never hides the current logged-in user, pending real invites, or admin/owner operators
const isSimulatedUser = (member) => {
  const currentUserId = authStore.user?.id || authStore.user?.userId
  if (currentUserId && member.id === currentUserId) return false
  if (member.status === 'pending') return false
  // Admin/owner operators are always legitimate — never hide them
  if (member.role === 'admin' || member.role === 'owner') return false

  // Explicit provenance fields — safe in all environments (Local + customer).
  if (member.is_simulated || member.simulated || member.is_demo || member.demo || member.seed || member.is_seed) return true
  if (member.source === 'simulated' || member.source === 'seed' || member.source === 'demo' || member.source === 'test') return true

  // Local/demo-scoped historical-fixture classifier.
  // The non-numeric github_id heuristic is only safe in Local/demo where the
  // known cm-activity-sim population uses string github_id values like
  // "demo_cursor_user_1_1777930428_1" or "cursor_user_0_1778532763_hex".
  // A customer environment may have legacy non-numeric github_id values from
  // migrations or other auth systems — those must NOT be hidden.
  if (isLocal()) {
    const gid = member.github_id
    if (gid !== null && gid !== undefined && String(gid) !== '' && !/^\d+$/.test(String(gid))) {
      return true
    }
  }

  // Email/name pattern classifier — safe in all environments.
  // These match obvious demo/sim patterns, not real customer domains.
  const name = (member.name || '').toLowerCase()
  const email = (member.email || '').toLowerCase()
  const simulatedPatterns = [
    /^dev\d+@/, /^developer\d+@/, /^test\d+@/, /^simulated\d+@/,
    /^seed\d+@/, /^demo\d+@/, /^fake\d+@/,
    /@example\.com$/, /@test\.com$/, /@simulated\.com$/,
    /@chaosmonkey\.local$/,
    /^high-performer@/, /^avg-dev@/, /^struggling-dev@/,
    /^simulated\s/i, /^seed\s/i, /^demo\s/i, /^test\s/i,
    /^dev\s\d+/i, /^developer\s\d+/i
  ]
  return simulatedPatterns.some(p => p.test(email) || p.test(name))
}

const isBlankPendingInvite = (m) => {
  if (m.status !== 'pending') return false
  // The backend substitutes 'Pending invitation' for null-email invites —
  // treat it as no email. A pending invite with no email can never be a
  // labeled customer enrollment (post-18H enrollments require email), so
  // hide it regardless of whether a connect code was issued.
  const noEmail = !m.email || !m.email.trim() || m.email.trim().toLowerCase() === 'pending invitation'
  const noUsefulName = !m.name || !m.name.trim() || ['pending invitation', 'pending', 'invitation'].includes(m.name.trim().toLowerCase())
  return noEmail && noUsefulName
}

// Operator/support enrollments are never customer developer identities.
// Display-layer exclusion only — invites and telemetry remain on the backend.
const isOperatorEnrollment = (m) => m.status === 'pending' && isOperatorEnrollmentEmail(m.email)

const visibleTeamMembers = computed(() => teamMembers.value.filter(m => !isSimulatedUser(m) && !isBlankPendingInvite(m) && !isOperatorEnrollment(m)))

// CR-X Team clarity: split dashboard members (GitHub-authenticated, active) from
// developer enrollments (invite-based, pending). These are distinct concepts:
//   - Dashboard member: authenticates to the dashboard, has org role/admin/member
//   - Developer enrollment: telemetry identity with personal enrollment credential
// The same human may legitimately have both identities.
const dashboardMembers = computed(() => visibleTeamMembers.value.filter(m => m.status === 'active'))
const developerEnrollments = computed(() => visibleTeamMembers.value.filter(m => m.status === 'pending' && m.invite_kind !== 'dashboard'))
// Pending dashboard-user invites (e.g. invited admins who have not accepted
// yet). These are NOT developer enrollments — they surface recovery actions
// (copy/reissue) instead of enrollment-code controls.
const pendingDashboardInvites = computed(() => visibleTeamMembers.value.filter(m => m.status === 'pending' && m.invite_kind === 'dashboard'))

// CR-X: Admin check for showing role/action controls
const isAdmin = computed(() => (userInfo.value.role || 'admin') === 'admin')

// CR-X: Dashboard user invite state
const dashInviteEmail = ref('')
const dashInviteRole = ref('member')
const dashInviteError = ref('')
const isCreatingDashInvite = ref(false)
const dashInviteLink = ref('')
const dashInviteAlert = ref({ show: false, type: 'success', message: '' })

const createDashInvite = async () => {
  if (isCreatingDashInvite.value) return
  const email = dashInviteEmail.value.trim()
  dashInviteError.value = ''
  dashInviteAlert.value = { show: false, type: 'success', message: '' }
  dashInviteLink.value = ''

  if (!email) {
    dashInviteError.value = 'Enter an email address for the invite.'
    return
  }

  isCreatingDashInvite.value = true
  try {
    const response = await api.post('/api/org/invites', {
      email,
      role: dashInviteRole.value,
      send_email: false,
      expires_hours: 168,
    })
    // Backend returns shareable_url like http://localhost:8010/invite/{token}
    // Frontend route is /accept-invite/{token}
    const shareableUrl = response.data?.shareable_url || ''
    const tokenMatch = shareableUrl.match(/\/invite\/([^/?#]+)/)
    const inviteToken = tokenMatch ? tokenMatch[1] : (response.data?.invite?.token || '')
    if (inviteToken) {
      dashInviteLink.value = `${window.location.origin}/accept-invite/${inviteToken}`
    }
    dashInviteAlert.value = {
      show: true,
      type: 'success',
      message: `Invite created for ${email} (${dashInviteRole.value}). Share the link below.`
    }
    dashInviteEmail.value = ''
    await fetchOrganizationData()
  } catch (error) {
    const status = error.response?.status
    const apiMessage = error.response?.data?.message || error.response?.data?.error
    if (status === 422) {
      dashInviteAlert.value = {
        show: true,
        type: 'warning',
        message: apiMessage || `An invite for ${email} already exists.`
      }
    } else if (status === 403) {
      dashInviteAlert.value = {
        show: true,
        type: 'danger',
        message: 'Only admins can create invites.'
      }
    } else {
      dashInviteAlert.value = {
        show: true,
        type: 'danger',
        message: apiMessage || 'Failed to create invite. Please try again.'
      }
    }
  } finally {
    isCreatingDashInvite.value = false
  }
}

const copyDashInviteLink = () => {
  if (!dashInviteLink.value) return
  navigator.clipboard.writeText(dashInviteLink.value)
  dashInviteAlert.value = {
    show: true,
    type: 'success',
    message: 'Invite link copied to clipboard.'
  }
}

// Pending dashboard-invite recovery — the token never lives in the roster
// payload; these endpoints emit it only to an admin on explicit request.
const inviteAcceptUrlFromShareable = (shareableUrl) => {
  const tokenMatch = (shareableUrl || '').match(/\/invite\/([^/?#]+)/)
  return tokenMatch ? `${window.location.origin}/accept-invite/${tokenMatch[1]}` : ''
}

const copyPendingInviteLink = async (member) => {
  if (!member.invite_id) return
  dashInviteAlert.value = { show: false, type: 'success', message: '' }
  try {
    const response = await api.post(`/api/org/invites/${member.invite_id}/accept-link`)
    const url = inviteAcceptUrlFromShareable(response.data?.shareable_url)
    if (!url) throw new Error('no link returned')
    await navigator.clipboard.writeText(url)
    dashInviteAlert.value = {
      show: true,
      type: 'success',
      message: `Invite link for ${member.email} copied to clipboard.`
    }
  } catch (error) {
    const msg = error.response?.data?.message || 'Could not retrieve the invite link. Reissue it instead.'
    dashInviteAlert.value = { show: true, type: 'warning', message: msg }
  }
}

const reissueDashInvite = async (member) => {
  if (!member.invite_id) return
  showTeamConfirm(
    'Reissue Invite',
    `Generate a new invite link for ${member.email}? The previous link will stop working immediately.`,
    async () => {
      try {
        const response = await api.post(`/api/org/invites/${member.invite_id}/reissue`, { expires_hours: 168 })
        const url = inviteAcceptUrlFromShareable(response.data?.shareable_url)
        if (url) dashInviteLink.value = url
        dashInviteAlert.value = {
          show: true,
          type: 'success',
          message: `Invite reissued for ${member.email}. The previous link is invalid — share the new link below.`
        }
        await fetchOrganizationData({ silent: true })
      } catch (error) {
        const msg = error.response?.data?.message || 'Failed to reissue invite. Please try again.'
        dashInviteAlert.value = { show: true, type: 'danger', message: msg }
      }
    }
  )
}

// State
const activeTab = ref('profile')
const showPasswordModal = ref(false)
const isLoading = ref(false)
const isLoadingTeam = ref(false)
const teamLoadError = ref(null)
const loadingStates = ref({})
const showTwoFactorModal = ref(false)

// Teams state
const teamMembers = ref([])

// Visible enrollment codes — presentation-only state (invite_id → code string).
// Populated by Show code / Generate code; cleared by Hide code.
// Never persisted; does not survive refresh (roster has_connect_code drives the Generated label).
const visibleCodes = ref({})

// Settings invite form
const settingsInviteForm = ref({
  email: '',
  role: 'member'
})
const settingsInviteFormErrors = ref({
  email: ''
})
const isSendingInvite = ref(false)

// Additional invite properties
const invite = ref(null)
const inviteEmail = ref('')
const inviteExpires = ref('24')
const generatingInvite = ref(false)

// Email invite alert state
const emailInviteAlert = ref({
  show: false,
  type: 'success',
  message: ''
})

// Developer enrollment state (replaces email-based rollout)
const isCreatingEnrollment = ref(false)
const newDeveloperEmail = ref('')
const newDeveloperEmailError = ref('')
const enrollmentAlert = ref({
  show: false,
  type: 'success',
  message: ''
})

const isValidEmail = (value) => {
  const trimmed = (value || '').trim()
  if (!trimmed) return false
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)
}

const createDeveloperEnrollment = async () => {
  if (isCreatingEnrollment.value) return

  const email = newDeveloperEmail.value.trim()
  newDeveloperEmailError.value = ''
  if (!email) {
    newDeveloperEmailError.value = 'Enter a developer email or identifier to create an enrollment.'
    return
  }
  if (!isValidEmail(email)) {
    newDeveloperEmailError.value = 'Enter a valid email address for the developer.'
    return
  }

  isCreatingEnrollment.value = true
  enrollmentAlert.value = { show: false, type: 'success', message: '' }

  try {
    const payload = {
      role: 'member',
      email,
      send_email: false,
      purpose: 'developer_enrollment',
    }
    // K1B: optional cohort assignment — omitted entirely when none selected.
    if (enrollCohortId.value !== '') {
      payload.cohort_id = Number(enrollCohortId.value)
    }
    await api.post('/api/org/invites', payload)

    newDeveloperEmail.value = ''
    enrollmentAlert.value = {
      show: true,
      type: 'success',
      message: `Developer enrollment created for ${email}. Generate their enrollment code, then copy the setup instructions.`
    }
    await fetchOrganizationData()
  } catch (error) {
    const status = error.response?.status
    const apiMessage = error.response?.data?.message || error.response?.data?.error
    // 422 = duplicate active/pending email already exists for this org
    if (status === 422) {
      enrollmentAlert.value = {
        show: true,
        type: 'warning',
        message: apiMessage || `An enrollment for ${email} already exists. Find it in the list above.`
      }
    } else {
      enrollmentAlert.value = {
        show: true,
        type: 'danger',
        message: apiMessage || 'Failed to create developer enrollment. Please try again.'
      }
    }
  } finally {
    isCreatingEnrollment.value = false
  }
}

const bulkRolloutOpen = ref(false)
const bulkEmailsText = ref('')
const bulkRolloutError = ref('')
const bulkRolloutAlert = ref({ show: false, type: 'success', message: '' })
const bulkRolloutFailureSummary = ref(null)
const bulkRolloutResult = ref(null)
const isCreatingBulkRollout = ref(false)
const bulkInputSummary = computed(() => parseBulkEnrollmentInput(bulkEmailsText.value))

// ── K1B: Developer Cohorts (organization-scoped, server-authoritative) ──
const cohorts = ref([])
const cohortsLoadError = ref('')
const cohortAlert = ref({ show: false, type: 'success', message: '' })
const newCohortName = ref('')
const newCohortDescription = ref('')
const isCreatingCohort = ref(false)
const editingCohortId = ref(null)
const editingCohortName = ref('')
const expandedCohortId = ref(null)
const cohortMembers = ref({})
const cohortMembersLoading = ref(false)
// Optional cohort targets for enrollment flows ('' = no cohort assignment)
const enrollCohortId = ref('')
const bulkCohortId = ref('')

const activeCohorts = computed(() => cohorts.value.filter(c => !c.archived_at))
const archivedCohorts = computed(() => cohorts.value.filter(c => !!c.archived_at))

const fetchCohorts = async () => {
  try {
    const response = await api.get('/api/org/cohorts')
    cohorts.value = response.data.cohorts || response.data || []
    cohortsLoadError.value = ''
  } catch (error) {
    cohorts.value = []
    cohortsLoadError.value = error.response?.status === 401 ? 'session_expired' : 'load_failed'
  }
}

const createCohort = async () => {
  if (isCreatingCohort.value) return
  const name = newCohortName.value.trim()
  cohortAlert.value = { show: false, type: 'success', message: '' }
  if (!name) {
    cohortAlert.value = { show: true, type: 'warning', message: 'Enter a cohort name.' }
    return
  }
  isCreatingCohort.value = true
  try {
    await api.post('/api/org/cohorts', {
      name,
      description: newCohortDescription.value.trim() || undefined,
    })
    newCohortName.value = ''
    newCohortDescription.value = ''
    cohortAlert.value = { show: true, type: 'success', message: `Cohort "${name}" created.` }
    await fetchCohorts()
  } catch (error) {
    const apiMessage = error.response?.data?.message || error.response?.data?.error
    cohortAlert.value = {
      show: true,
      type: error.response?.status === 422 ? 'warning' : 'danger',
      message: apiMessage || 'Failed to create cohort.',
    }
  } finally {
    isCreatingCohort.value = false
  }
}

const startEditCohort = (cohort) => {
  editingCohortId.value = cohort.id
  editingCohortName.value = cohort.name
}

const cancelEditCohort = () => {
  editingCohortId.value = null
  editingCohortName.value = ''
}

const renameCohort = async (cohort) => {
  const name = editingCohortName.value.trim()
  if (!name || name === cohort.name) {
    cancelEditCohort()
    return
  }
  try {
    await api.patch(`/api/org/cohorts/${cohort.id}`, { name })
    cohortAlert.value = { show: true, type: 'success', message: `Cohort renamed to "${name}".` }
    cancelEditCohort()
    await fetchCohorts()
  } catch (error) {
    const apiMessage = error.response?.data?.message || error.response?.data?.error
    cohortAlert.value = { show: true, type: 'danger', message: apiMessage || 'Failed to rename cohort.' }
  }
}

const archiveCohort = async (cohort) => {
  try {
    await api.post(`/api/org/cohorts/${cohort.id}/archive`)
    cohortAlert.value = { show: true, type: 'success', message: `Cohort "${cohort.name}" archived. Membership is retained for history but the cohort no longer accepts assignments or filters.` }
    if (expandedCohortId.value === cohort.id) expandedCohortId.value = null
    if (enrollCohortId.value === String(cohort.id)) enrollCohortId.value = ''
    if (bulkCohortId.value === String(cohort.id)) bulkCohortId.value = ''
    await fetchCohorts()
  } catch (error) {
    const apiMessage = error.response?.data?.message || error.response?.data?.error
    cohortAlert.value = { show: true, type: 'danger', message: apiMessage || 'Failed to archive cohort.' }
  }
}

const loadCohortMembers = async (cohort) => {
  if (expandedCohortId.value === cohort.id) {
    expandedCohortId.value = null
    return
  }
  expandedCohortId.value = cohort.id
  cohortMembersLoading.value = true
  try {
    const response = await api.get(`/api/org/cohorts/${cohort.id}/members`)
    cohortMembers.value = { ...cohortMembers.value, [cohort.id]: response.data.members || [] }
  } catch (error) {
    cohortAlert.value = { show: true, type: 'danger', message: 'Failed to load cohort membership.' }
    expandedCohortId.value = null
  } finally {
    cohortMembersLoading.value = false
  }
}

// Assign/reassign an enrollment to a cohort, or remove ('' → unassigned).
const setMemberCohort = async (member, cohortId) => {
  cohortAlert.value = { show: false, type: 'success', message: '' }
  try {
    if (cohortId === '' || cohortId === null) {
      if (member.cohort_id) {
        await api.delete(`/api/org/cohorts/${member.cohort_id}/members/${member.invite_id}`)
      }
    } else {
      await api.post(`/api/org/cohorts/${cohortId}/members`, { invite_ids: [member.invite_id] })
    }
    await fetchOrganizationData({ silent: true })
    await fetchCohorts()
  } catch (error) {
    const apiMessage = error.response?.data?.message || error.response?.data?.error
    cohortAlert.value = { show: true, type: 'danger', message: apiMessage || 'Failed to update cohort membership.' }
  }
}

const createBulkRollout = createBulkRolloutHandler({
  bulkEmailsText,
  bulkRolloutError,
  bulkRolloutAlert,
  bulkRolloutFailureSummary,
  bulkRolloutResult,
  isCreatingBulkRollout,
}, {
  isAdmin: () => isAdmin.value,
  apiPost: (url, payload) => api.post(url, payload),
  refreshOrganizationData: () => fetchOrganizationData({ silent: true }),
  onUnauthorized: () => {
    teamLoadError.value = 'session_expired'
  },
  // K1B: optional cohort target for the shared-link rollout batch.
  getCohortId: () => bulkCohortId.value === '' ? null : Number(bulkCohortId.value),
})

const copyBulkRolloutLink = async () => {
  const rolloutUrl = bulkRolloutResult.value?.rollout_url
  if (!rolloutUrl) return

  try {
    await copyText(rolloutUrl)
    bulkRolloutAlert.value = {
      show: true,
      type: 'success',
      message: 'Rollout link copied. Save it before dismissing this result.'
    }
  } catch (error) {
    bulkRolloutAlert.value = {
      show: true,
      type: 'danger',
      message: 'Failed to copy the rollout link.'
    }
  }
}

const resetBulkRollout = () => {
  bulkRolloutResult.value = null
  bulkRolloutFailureSummary.value = null
  bulkRolloutError.value = ''
  bulkRolloutAlert.value = { show: false, type: 'success', message: '' }
  bulkEmailsText.value = ''
  bulkRolloutOpen.value = true
}

const copyText = async (text) => {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text)
    return
  }

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  textarea.style.pointerEvents = 'none'
  document.body.appendChild(textarea)
  textarea.focus()
  textarea.select()

  const copied = document.execCommand('copy')
  textarea.remove()

  if (!copied) {
    throw new Error('Clipboard copy failed')
  }
}

// Team management modal state
const teamModal = ref({
  show: false,
  type: 'info',
  title: '',
  message: '',
  confirmText: 'OK',
  cancelText: 'Cancel',
  showCancel: false,
  onConfirm: null,
  onCancel: null
})

// Team management modal functions
const showTeamModal = (type, title, message, options = {}) => {
  teamModal.value = {
    show: true,
    type,
    title,
    message,
    confirmText: options.confirmText || 'OK',
    cancelText: options.cancelText || 'Cancel',
    showCancel: options.showCancel || false,
    onConfirm: options.onConfirm || null,
    onCancel: options.onCancel || null
  }
}

const showTeamAlert = (type, title, message) => {
  showTeamModal(type, title, message, { showCancel: false })
}

const showTeamConfirm = (title, message, onConfirm, onCancel = null) => {
  showTeamModal('warning', title, message, {
    showCancel: true,
    confirmText: 'Confirm',
    cancelText: 'Cancel',
    onConfirm,
    onCancel
  })
}

const hideTeamModal = () => {
  teamModal.value.show = false
  teamModal.value.onConfirm = null
  teamModal.value.onCancel = null
}

const handleTeamModalConfirm = () => {
  if (teamModal.value.onConfirm) {
    teamModal.value.onConfirm()
  }
  hideTeamModal()
}

const handleTeamModalCancel = () => {
  if (teamModal.value.onCancel) {
    teamModal.value.onCancel()
  }
  hideTeamModal()
}

// Modal helper functions
const getModalIcon = (type) => {
  switch (type) {
    case 'success':
      return 'bi-check-circle-fill text-success'
    case 'danger':
      return 'bi-exclamation-triangle-fill text-danger'
    case 'warning':
      return 'bi-exclamation-triangle-fill text-warning'
    case 'info':
    default:
      return 'bi-info-circle-fill text-info'
  }
}

const getModalButtonClass = (type) => {
  switch (type) {
    case 'success':
      return 'btn-success'
    case 'danger':
      return 'btn-danger'
    case 'warning':
      return 'btn-warning'
    case 'info':
    default:
      return 'btn-primary'
  }
}
const organizationInfo = ref({
  id: null,
  name: null,
  slug: null
})
const userInfo = ref({
  id: null,
  name: null,
  role: null
})

// Billing state
const billingHistory = ref([
  {
    id: 1,
    date: '2026-02-15',
    description: 'Monthly subscription',
    amount: '29.00',
    status: 'Paid'
  },
  {
    id: 2,
    date: '2026-01-15',
    description: 'Monthly subscription',
    amount: '29.00',
    status: 'Paid'
  },
  {
    id: 3,
    date: '2025-12-15',
    description: 'Monthly subscription',
    amount: '29.00',
    status: 'Paid'
  }
])

// Form validation errors
const profileFormErrors = ref({})
const passwordFormErrors = ref({})

// Profile form
const profileForm = ref({
  firstName: '',
  lastName: '',
  email: '',
  bio: ''
})

// Notification form
const notificationForm = ref({
  emailAlerts: true,
  weeklyReports: true,
  teamUpdates: false
})

// Preferences form
const preferencesForm = ref({
  theme: 'light',
  language: 'en'
})

// Password form
const passwordForm = ref({
  currentPassword: '',
  newPassword: '',
  confirmPassword: ''
})

// API calls for user settings via centralized api client
const callApi = async (endpoint, data = null, method = 'GET') => {
  try {
    const url = `/api${endpoint}`
    if (method === 'GET') {
      const response = await api.get(url)
      return response.data
    } else if (method === 'PUT') {
      const response = await api.put(url, data)
      return response.data
    } else {
      const response = await api.post(url, data)
      return response.data
    }
  } catch (error) {
    console.error(`API Call to ${endpoint} failed:`, error)
    throw error
  }
}

// Loading states for different actions
const getLoadingKey = (action) => `${action}_global`

// Integrations data
// CR-X B6: GitHub Engineering Data connection state
const githubEngineeringState = ref({
  loading: true,
  connecting: false,
  connected: false,
  identityOnly: false,
  tokenPurpose: null,
  // CR-X 18B: customer repository authority gate
  repoAuthority: false,
  repoAuthorityMessage: '',
})

async function checkGitHubEngineeringState() {
  githubEngineeringState.value.loading = true
  try {
    const response = await fetch(`${API_URL}/github/oauth/status`)
    if (response.ok) {
      const data = await response.json()
      const purpose = data.token_purpose
      githubEngineeringState.value.tokenPurpose = purpose
      githubEngineeringState.value.connected = purpose === 'engineering_integration'
      githubEngineeringState.value.identityOnly = purpose === 'identity_only'
      // CR-X 18B: distinguish engineering token from customer repo authority
      githubEngineeringState.value.repoAuthority = !!data.repo_authority
      githubEngineeringState.value.repoAuthorityMessage = data.repo_authority_message || ''
    }
  } catch (err) {
    console.error('[Settings] Failed to check GitHub engineering state:', err)
  } finally {
    githubEngineeringState.value.loading = false
  }
}

async function connectGitHubEngineeringData() {
  githubEngineeringState.value.connecting = true
  try {
    // Reuse the existing OAuth flow with explicit engineering intent.
    // The backend selects repo scope only for intent=engineering and
    // classifies the resulting token as engineering_integration.
    // authenticatedFetch sends the dashboard Bearer token so the backend
    // can verify the engineering intent originates from an authenticated
    // dashboard organization context.
    const response = await authenticatedFetch(`${API_URL}/github/oauth/redirect?intent=engineering`, {
      method: 'GET',
    })
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }
    const data = await response.json()
    if (data.auth_url) {
      window.location.href = data.auth_url
    } else {
      throw new Error('No auth URL received from backend')
    }
  } catch (error) {
    console.error('[Settings] GitHub Engineering Data connect failed:', error)
    githubEngineeringState.value.connecting = false
  }
}

// Methods
// Form validation
const validateProfileForm = () => {
  const errors = {}
  
  if (!profileForm.value.firstName) {
    errors.firstName = 'First name is required'
  } else if (profileForm.value.firstName.length < 2) {
    errors.firstName = 'First name must be at least 2 characters'
  }
  
  if (!profileForm.value.lastName) {
    errors.lastName = 'Last name is required'
  } else if (profileForm.value.lastName.length < 2) {
    errors.lastName = 'Last name must be at least 2 characters'
  }
  
  if (!profileForm.value.email) {
    errors.email = 'Email is required'
  } else if (!/\S+@\S+\.\S+/.test(profileForm.value.email)) {
    errors.email = 'Please enter a valid email address'
  }
  
  profileFormErrors.value = errors
  return Object.keys(errors).length === 0
}

const validatePasswordForm = () => {
  const errors = {}
  
  if (!passwordForm.value.currentPassword) {
    errors.currentPassword = 'Current password is required'
  }
  
  if (!passwordForm.value.newPassword) {
    errors.newPassword = 'New password is required'
  } else if (passwordForm.value.newPassword.length < 8) {
    errors.newPassword = 'Password must be at least 8 characters long'
  } else if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(passwordForm.value.newPassword)) {
    errors.newPassword = 'Password must contain uppercase, lowercase, and number'
  }
  
  if (!passwordForm.value.confirmPassword) {
    errors.confirmPassword = 'Please confirm your new password'
  } else if (passwordForm.value.newPassword !== passwordForm.value.confirmPassword) {
    errors.confirmPassword = 'Passwords do not match'
  }
  
  passwordFormErrors.value = errors
  return Object.keys(errors).length === 0
}

const showSuccessMessage = (message) => {
  // Create a simple success notification
  const notification = document.createElement('div')
  notification.className = 'alert alert-success position-fixed top-0 end-0 m-3'
  notification.style.zIndex = '9999'
  notification.innerHTML = `
    <i class="bi bi-check-circle me-2"></i>${message}
  `
  document.body.appendChild(notification)
  
  setTimeout(() => {
    notification.remove()
  }, 3000)
}

const updateProfile = async () => {
  if (!validateProfileForm()) return
  
  const loadingKey = getLoadingKey('profile')
  loadingStates.value[loadingKey] = true
  
  try {
    // Get GitHub user data from auth store
    const githubUser = authStore.user || {}
    const profileData = {
      ...profileForm.value,
      github_username: githubUser?.login || 'unknown',
      github_avatar: githubUser?.avatar_url || '',
      github_id: githubUser?.id || null,
      updated_at: new Date().toISOString()
    }
    
    // Save to localStorage for MVP
    localStorage.setItem('chaosmonkey_profile', JSON.stringify(profileData))
    
    // Try backend API
    await callApi('/user/profile', profileData, 'PUT')
    
    showSuccessMessage('Profile updated successfully!')
  } catch (error) {
    console.error('Failed to update profile:', error)
    showSuccessMessage('Profile saved locally!')
  } finally {
    loadingStates.value[loadingKey] = false
  }
}

const saveNotifications = async () => {
  const loadingKey = getLoadingKey('notifications')
  loadingStates.value[loadingKey] = true
  
  try {
    // Save to localStorage for MVP
    localStorage.setItem('chaosmonkey_notifications', JSON.stringify(notificationForm.value))
    
    // Try backend API
    await callApi('/user/notifications', notificationForm.value, 'PUT')
    
    showSuccessMessage('Notification preferences saved!')
  } catch (error) {
    console.error('Failed to save notifications:', error)
    showSuccessMessage('Preferences saved locally!')
  } finally {
    loadingStates.value[loadingKey] = false
  }
}

const savePreferences = async () => {
  const loadingKey = getLoadingKey('preferences')
  loadingStates.value[loadingKey] = true
  
  try {
    // Save to localStorage for MVP
    localStorage.setItem('chaosmonkey_preferences', JSON.stringify(preferencesForm.value))
    
    // Try backend API
    await callApi('/user/preferences', preferencesForm.value, 'PUT')
    
    showSuccessMessage('Preferences saved!')
  } catch (error) {
    console.error('Failed to save preferences:', error)
    showSuccessMessage('Preferences saved locally!')
  } finally {
    loadingStates.value[loadingKey] = false
  }
}

const changePassword = async () => {
  if (!validatePasswordForm()) return
  
  const loadingKey = getLoadingKey('password')
  loadingStates.value[loadingKey] = true
  
  try {
    await new Promise(resolve => setTimeout(resolve, 500))
    console.log('Password change (MVP - localStorage only)')
    
    showPasswordModal.value = false
    passwordForm.value = {
      currentPassword: '',
      newPassword: '',
      confirmPassword: ''
    }
    passwordFormErrors.value = {}
    
    showSuccessMessage('Password changed successfully!')
  } catch (error) {
    console.error('Failed to change password:', error)
  } finally {
    loadingStates.value[loadingKey] = false
  }
}

const enableTwoFactor = async () => {
  const loadingKey = getLoadingKey('2fa')
  loadingStates.value[loadingKey] = true
  
  try {
    await new Promise(resolve => setTimeout(resolve, 500))
    console.log('2FA enable (MVP - simulated)')
    showTwoFactorModal.value = false
    showSuccessMessage('Two-factor authentication enabled!')
  } catch (error) {
    console.error('Failed to enable 2FA:', error)
  } finally {
    loadingStates.value[loadingKey] = false
  }
}

const handleLogout = async () => {
  await authStore.logout()
  router.push('/login')
}

const handleSessionExpired = async () => {
  localStorage.removeItem('api_token')
  await authStore.logout()
  router.push('/login')
}

const goToDashboards = () => {
  router.push('/dashboards')
}

// Teams management methods
const getRoleBadgeClass = (role) => {
  switch (role) {
    case 'admin':
      return 'bg-warning'
    case 'Admin':
      return 'bg-warning'
    case 'Member':
      return 'bg-secondary'
    default:
      return 'bg-secondary'
  }
}

const getStatusBadgeClass = (status) => {
  switch (status) {
    case 'active':
      return 'bg-success'
    case 'pending':
      return 'bg-warning'
    default:
      return 'bg-secondary'
  }
}

const getStatusIcon = (status) => {
  switch (status) {
    case 'active':
      return 'bi-check-circle-fill'
    case 'pending':
      return 'bi-clock-history'
    default:
      return 'bi-question-circle'
  }
}

// Customer-facing enrollment status for pending developer invites.
// active users -> Active; pending invites -> Pending / Ready to connect / Code revoked / Code expired (legacy) / Connected
const memberStatusLabel = (member) => {
  if (member.status === 'active') return 'Active'
  if (member.status === 'pending') {
    switch (member.enrollment_status) {
      case 'connected': return 'Connected'
      case 'ready': return 'Ready to connect'
      case 'revoked': return 'Code revoked'
      case 'expired': return 'Code expired'
      default: return 'Pending'
    }
  }
  return member.status || 'unknown'
}

const memberStatusBadgeClass = (member) => {
  if (member.status === 'active') return 'bg-success'
  if (member.status === 'pending') {
    switch (member.enrollment_status) {
      case 'connected': return 'bg-success'
      case 'ready': return 'bg-primary'
      case 'revoked': return 'bg-danger'
      case 'expired': return 'bg-danger'
      default: return 'bg-warning'
    }
  }
  return 'bg-secondary'
}

const memberStatusIcon = (member) => {
  if (member.status === 'active') return 'bi-check-circle-fill'
  if (member.status === 'pending') {
    switch (member.enrollment_status) {
      case 'connected': return 'bi-plug-fill'
      case 'ready': return 'bi-check2-circle'
      case 'revoked': return 'bi-slash-circle'
      case 'expired': return 'bi-exclamation-triangle-fill'
      default: return 'bi-clock-history'
    }
  }
  return 'bi-question-circle'
}

const removeMember = (member) => {
  showTeamConfirm(
    'Remove Team Member',
    `Are you sure you want to remove ${member.name} from the team?`,
    async () => {
      try {
        await api.delete(`/api/org/users/${member.id}`)
        showTeamAlert('success', 'Member Removed', `${member.name} has been removed from the team.`)
        await fetchOrganizationData()
      } catch (error) {
        const msg = error.response?.data?.message || 'Failed to remove member'
        showTeamAlert('danger', 'Remove Failed', msg)
      }
    }
  )
}

// CR-X: Promote member to admin
const promoteMember = (member) => {
  showTeamConfirm(
    'Promote to Admin',
    `Promote ${member.name} to organization admin?`,
    async () => {
      try {
        await api.post(`/api/org/users/${member.id}/role`, { role: 'admin' })
        showTeamAlert('success', 'Role Updated', `${member.name} is now an admin.`)
        await fetchOrganizationData()
      } catch (error) {
        const msg = error.response?.data?.message || 'Failed to promote member'
        showTeamAlert('danger', 'Promotion Failed', msg)
      }
    }
  )
}

// CR-X: Demote admin to member
const demoteMember = (member) => {
  showTeamConfirm(
    'Demote to Member',
    `Demote ${member.name} from admin to member?`,
    async () => {
      try {
        await api.post(`/api/org/users/${member.id}/role`, { role: 'member' })
        showTeamAlert('success', 'Role Updated', `${member.name} is now a member.`)
        await fetchOrganizationData()
      } catch (error) {
        const msg = error.response?.data?.message || 'Failed to demote member'
        showTeamAlert('danger', 'Demotion Failed', msg)
      }
    }
  )
}

// CR-X: Cancel a pending invite — see implementation below (replaces old stub)

// Invite management functions
const resendInvite = async (member) => {
  if (!member.email) {
    emailInviteAlert.value = {
      show: true,
      type: 'danger',
      message: 'Cannot resend invite - no email address'
    }
    return
  }
  
  console.log('Resending invite to:', member.email, 'Status:', member.status)

  try {
    let response
    if (member.status === 'pending') {
      // Resend existing pending invite
      response = await api.post('/api/org/invites/resend', {
        email: member.email,
        role: member.role || 'member'
      })
      
      emailInviteAlert.value = {
        show: true,
        type: 'success',
        message: `Invite resent successfully to ${member.email}!`
      }
    } else {
      // Create new invite for active user (sends them a new invite link)
      response = await api.post('/api/org/invites', {
        email: member.email,
        role: member.role || 'member',
        expires_hours: 24
      })
      
      emailInviteAlert.value = {
        show: true,
        type: 'success',
        message: `New invite sent to ${member.email}!`
      }
    }
    
    console.log('Resend invite response:', response.data)
    
    // Refresh team data
    await fetchOrganizationData()
    
  } catch (error) {
    console.error('Failed to resend invite:', error)
    
    // Show user-friendly error message
    if (error.response?.data?.error) {
      const errorType = error.response.data.error
      const errorMessage = error.response.data.message
      
      if (errorType === 'No pending invite found') {
        emailInviteAlert.value = {
          show: true,
          type: 'warning',
          message: errorMessage
        }
      } else {
        emailInviteAlert.value = {
          show: true,
          type: 'danger',
          message: errorMessage
        }
      }
    } else {
      emailInviteAlert.value = {
        show: true,
        type: 'danger',
        message: 'Failed to resend invite. Please try again.'
      }
    }
  }
}

const cancelInvite = async (member) => {
  if (!member.invite_id) {
    console.error('No invite ID found for member:', member)
    return
  }

  showTeamConfirm(
    'Cancel Invite',
    `Are you sure you want to cancel the invite for ${member.email}?`,
    async () => {
      try {
        await api.delete(`/api/org/invites/${member.invite_id}`)
        showTeamAlert('success', 'Invite Cancelled', `Invite for ${member.email} has been cancelled.`)
        await fetchOrganizationData()
      } catch (error) {
        const msg = error.response?.data?.message || 'Failed to cancel invite'
        showTeamAlert('danger', 'Cancel Failed', msg)
      }
    }
  )
}

// Billing methods
const getInvoiceStatusClass = (status) => {
  switch (status) {
    case 'Paid':
      return 'bg-success'
    case 'Pending':
      return 'bg-warning'
    case 'Failed':
      return 'bg-danger'
    default:
      return 'bg-secondary'
  }
}

// Invite methods
const inviteLink = computed(() => {
  return invite.value ? `${window.location.origin}/invite/${invite.value.token}` : ''
})

const formatDate = (dateString) => {
  return new Date(dateString).toLocaleString()
}

const generateInvite = async () => {
  generatingInvite.value = true
  
  try {
    console.log('Generating invite with data:', {
      email: inviteEmail.value || null,
      expires_hours: parseInt(inviteExpires.value)
    })
    
    const response = await api.post('/api/org/invites', {
      email: inviteEmail.value || null,
      expires_hours: parseInt(inviteExpires.value)
    })
    
    console.log('Invite API response:', response.data)
    
    if (response.data.invite) {
      invite.value = response.data.invite
      console.log('Invite created successfully:', response.data.invite)
    } else {
      // Fallback for demo - create mock invite
      const mockInvite = {
        token: Math.random().toString(36).substr(2, 9),
        email: inviteEmail.value,
        expires_at: new Date(Date.now() + parseInt(inviteExpires.value) * 60 * 60 * 1000).toISOString()
      }
      invite.value = mockInvite
      console.log('Fallback mock invite created:', mockInvite)
    }
  } finally {
    generatingInvite.value = false
  }
}

const copyInviteLink = async (event) => {
  const button = event?.target?.closest?.('button')
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(inviteLink.value)
    } else {
      const textarea = document.createElement('textarea')
      textarea.value = inviteLink.value
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      textarea.remove()
    }
    if (button) {
      const originalHTML = button.innerHTML
      button.innerHTML = '<i class="bi bi-check me-2"></i>Copied!'
      button.classList.add('btn-success')
      button.classList.remove('btn-outline-secondary')
      
      setTimeout(() => {
        button.innerHTML = originalHTML
        button.classList.remove('btn-success')
        button.classList.add('btn-outline-secondary')
      }, 2000)
    }
  } catch (error) {
    console.error('Failed to copy invite link:', error)
  }
}

const sendSettingsInvite = async () => {
  // Clear previous errors
  settingsInviteFormErrors.value.email = ''
  
  if (!settingsInviteForm.value.email) {
    settingsInviteFormErrors.value.email = 'Please enter an email address'
    return
  }
  
  // Basic email validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!emailRegex.test(settingsInviteForm.value.email)) {
    settingsInviteFormErrors.value.email = 'Please enter a valid email address'
    return
  }
  
  console.log('Sending email invite:', settingsInviteForm.value)
  isSendingInvite.value = true
  
  try {
    const response = await api.post('/api/org/invites', settingsInviteForm.value)
    
    console.log('Email invite response:', response.data)
    
    // Reset form
    const sentEmail = settingsInviteForm.value.email
    settingsInviteForm.value = {
      email: '',
      role: 'member'
    }
    
    // Show success message and refresh organization data
    emailInviteAlert.value = {
      show: true,
      type: 'success',
      message: `Enrollment created for ${sentEmail}. Generate the enrollment code, then copy the setup instructions.`
    }

    await fetchOrganizationData()

  } catch (error) {
    console.error('Failed to send invite:', error)
    
    // Show user-friendly error message
    if (error.response?.data?.error) {
      const errorType = error.response.data.error
      const errorMessage = error.response.data.message
      
      if (errorType === 'Email already exists') {
        emailInviteAlert.value = {
          show: true,
          type: 'warning',
          message: errorMessage
        }
      } else if (errorType === 'Invite already sent') {
        emailInviteAlert.value = {
          show: true,
          type: 'warning',
          message: errorMessage
        }
      } else {
        emailInviteAlert.value = {
          show: true,
          type: 'danger',
          message: errorMessage
        }
      }
    } else {
      emailInviteAlert.value = {
        show: true,
        type: 'danger',
        message: 'Failed to send invite. Please try again.'
      }
    }
  } finally {
    isSendingInvite.value = false
  }
}

// Removed showSuccessMessage function definition

// Enrollment code helpers
const generateConnectCode = async (member) => {
  if (!member.invite_id) return
  try {
    // regenerate=true whenever a code already exists (revoked or legacy-expired):
    // the backend revokes the prior code and issues a genuinely new one.
    const response = await api.post(`/api/org/invites/${member.invite_id}/connect-code`, {
      regenerate: !!member.has_connect_code,
    })
    visibleCodes.value = { ...visibleCodes.value, [member.invite_id]: response.data.connect_code }
    member.has_connect_code = true
    member.has_valid_connect_code = true
    member.connect_code_expired = false
    member.connect_code_revoked = false
    member.connect_code_expires_at = response.data.expires_at
    // Regenerating the bootstrap code must never downgrade a connected
    // enrollment — existing installation tokens are independent of the code.
    member.enrollment_status = (member.installation_count ?? 0) > 0 ? 'connected' : 'ready'
    emailInviteAlert.value = { show: true, type: 'success', message: `Enrollment code generated for ${member.email}` }
  } catch (error) {
    console.error('Failed to generate connect code:', error)
    emailInviteAlert.value = { show: true, type: 'danger', message: 'Failed to generate enrollment code.' }
  }
}

const showConnectCode = async (member) => {
  if (!member.invite_id) return
  try {
    const response = await api.post(`/api/org/invites/${member.invite_id}/connect-code`)
    visibleCodes.value = { ...visibleCodes.value, [member.invite_id]: response.data.connect_code }
  } catch (error) {
    console.error('Failed to show connect code:', error)
    emailInviteAlert.value = { show: true, type: 'danger', message: 'Failed to retrieve enrollment code.' }
  }
}

const hideConnectCode = (member) => {
  if (!member.invite_id) return
  const next = { ...visibleCodes.value }
  delete next[member.invite_id]
  visibleCodes.value = next
}

const copySetupInstructions = async (member) => {
  const code = visibleCodes.value[member.invite_id]
  if (!code) return
  const cursorAgentBridge = (await probeCursorAgentBridge(API_URL)) !== null
  const instructions = buildSetupInstructions(API_URL, code, { cursorAgentBridge })
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(instructions)
    } else {
      const textarea = document.createElement('textarea')
      textarea.value = instructions
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      textarea.remove()
    }
    emailInviteAlert.value = { show: true, type: 'success', message: 'Setup instructions copied to clipboard' }
  } catch (error) {
    console.error('Failed to copy:', error)
    emailInviteAlert.value = { show: true, type: 'danger', message: 'Failed to copy setup instructions' }
  }
}

const revokeConnectCode = async (member) => {
  if (!member.invite_id) return
  try {
    await api.delete(`/api/org/invites/${member.invite_id}/connect-code`)
    const next = { ...visibleCodes.value }
    delete next[member.invite_id]
    visibleCodes.value = next
    member.has_connect_code = false
    member.connect_code_expires_at = null
    emailInviteAlert.value = { show: true, type: 'success', message: `Enrollment code revoked for ${member.email}` }
  } catch (error) {
    console.error('Failed to revoke connect code:', error)
    emailInviteAlert.value = { show: true, type: 'danger', message: 'Failed to revoke enrollment code.' }
  }
}

// Organization methods
const fetchOrganizationData = async (options = {}) => {
  const silent = options?.silent === true
  try {
    if (!silent) isLoadingTeam.value = true
    console.log('Fetching organization data...')
    const response = await api.get('/api/org/users')
    console.log('Organization response:', response.data)
    
    if (response.data) {
      organizationInfo.value = response.data.organization
      userInfo.value = response.data.current_user
      teamMembers.value = response.data.users || []
      teamLoadError.value = null
      
      console.log('User role set to:', userInfo.value.role)
      console.log('Team members loaded:', teamMembers.value.length)
      
      // Store in localStorage for persistence
      localStorage.setItem('chaosmonkey_organization', JSON.stringify(response.data.organization))
      localStorage.setItem('chaosmonkey_user', JSON.stringify(response.data.current_user))
      return true
    }
    return false
  } catch (error) {
    console.error('Failed to fetch organization data:', error)
    
    if (!silent) {
      if (error.response?.status === 401) {
        teamLoadError.value = 'session_expired'
      } else {
        teamLoadError.value = 'load_failed'
      }
    }
    return false
  } finally {
    if (!silent) isLoadingTeam.value = false
  }
}

const getRoleIcon = (role) => {
  switch (role?.toLowerCase()) {
    case 'admin':
    case 'owner':
      return 'bi bi-shield-fill'
    case 'member':
      return 'bi bi-person'
    default:
      return 'bi bi-question-circle'
  }
}

// Tabs — only functional tabs are shown in nav and accepted by setTab.
// Nonfunctional tabs (notifications, security, billing, preferences)
// are gated out: they don't appear in the nav, and direct-URL access redirects
// to the profile tab with an unavailable notice.
// CR-X B6: Integrations tab is now functional (Connect GitHub Engineering Data).
const functionalTabs = ['profile', 'team', 'operator', 'integrations']
const validTabs = functionalTabs
const setTab = (tab) => {
  if (validTabs.includes(tab)) {
    activeTab.value = tab
  } else {
    activeTab.value = 'profile'
  }
}
watch(activeTab, (newTab) => {
  router.replace({ query: { ...route.query, tab: newTab } })
})

onMounted(async () => {
  // Apply ?tab= query parameter on load; invalid values fall back to profile
  const tabParam = route.query.tab
  if (typeof tabParam === 'string' && validTabs.includes(tabParam)) {
    activeTab.value = tabParam
  }

  // CR-X B6: Check GitHub Engineering Data connection state
  checkGitHubEngineeringState()

  // Load saved data from localStorage for MVP
  try {
    const savedProfile = localStorage.getItem('chaosmonkey_profile')
    const savedNotifications = localStorage.getItem('chaosmonkey_notifications')
    const savedPreferences = localStorage.getItem('chaosmonkey_preferences')
    
    // Populate form fields with saved data
    if (savedProfile) {
      const profile = JSON.parse(savedProfile)
      profileForm.value = {
        firstName: profile.first_name || profile.firstName || '',
        lastName: profile.last_name || profile.lastName || '',
        email: profile.email || '',
        bio: profile.bio || ''
      }
    }
    
    if (savedNotifications) {
      const notifications = JSON.parse(savedNotifications)
      notificationForm.value = {
        emailAlerts: notifications.emailAlerts ?? true,
        weeklyReports: notifications.weeklyReports ?? true,
        teamUpdates: notifications.teamUpdates ?? false
      }
    }
    
    if (savedPreferences) {
      const preferences = JSON.parse(savedPreferences)
      preferencesForm.value = {
        theme: preferences.theme || 'light',
        language: preferences.language || 'en'
      }
    }
    
    // Skip user settings API call for now - focus on team functionality
    console.log('Skipping user settings API call - using localStorage only')

    // Fetch organization data
    await fetchOrganizationData()

    // K1B: cohorts (any authenticated org member can read; mutations are
    // admin-only server-side — non-admins simply get no mutation controls)
    fetchCohorts()

    // CR-X: If no saved profile in localStorage, populate from the authenticated
    // GitHub user's identity so the Profile form isn't blank for GitHub-login users.
    if (!savedProfile && userInfo.value?.name) {
      const fullName = userInfo.value.name.trim()
      const spaceIdx = fullName.indexOf(' ')
      profileForm.value = {
        firstName: spaceIdx > 0 ? fullName.slice(0, spaceIdx) : fullName,
        lastName: spaceIdx > 0 ? fullName.slice(spaceIdx + 1) : '',
        email: userInfo.value.email || '',
        bio: profileForm.value.bio || ''
      }
    }
  } catch (error) {
    console.error('Failed to load settings:', error)
  }
})
</script>

<style scoped>
.settings-page {
  background-color: #f8f9fa;
  min-height: 100vh;
}

/* Dashboard Header */
.dashboard-header {
  background: #000000 !important;
  color: white;
  margin-bottom: 2rem;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
}

.header-content {
  padding: 0 1.5rem;
}

.dashboard-logo {
  height: 6.5rem;
  width: auto;
}

.dashboard-title {
  font-size: 3rem;
  font-weight: 700;
  margin: 0;
  text-shadow: 0 2px 4px rgba(0, 0, 0, 0.5);
  color: white;
  transition: transform 0.2s ease, text-shadow 0.2s ease;
}

.dashboard-title:hover {
  transform: scale(1.02);
  text-shadow: 0 4px 8px rgba(0, 0, 0, 0.7);
}

.settings-nav .nav-link {
  color: #6c757d;
  padding: 0.75rem 1rem;
  border-radius: 0.375rem;
  margin-bottom: 0.25rem;
  text-decoration: none;
  transition: all 0.2s ease;
}

.settings-nav .nav-link:hover {
  color: #000;
  background-color: #f8f9fa;
}

.settings-nav .nav-link.active {
  color: #fff;
  background-color: #007bff;
  font-weight: 500;
}

.settings-section {
  min-height: 400px;
}

.card {
  border: 1px solid #e9ecef;
  border-radius: 0.5rem;
}

.card-title {
  color: #000;
  font-weight: 600;
}

.form-label {
  color: #495057;
  font-weight: 500;
}

.form-control, .form-select {
  border: 1px solid #dee2e6;
  border-radius: 0.375rem;
  padding: 0.5rem 0.75rem;
}

.form-control:focus, .form-select:focus {
  border-color: #000;
  box-shadow: 0 0 0 0.2rem rgba(0, 0, 0, 0.25);
}

.form-check-input:checked {
  background-color: #000;
  border-color: #000;
}

.btn {
  border-radius: 0.375rem;
  font-weight: 500;
  padding: 0.5rem 1rem;
}

.btn-primary {
  background-color: #000;
  border-color: #000;
}

.btn-primary:hover {
  background-color: #333;
  border-color: #333;
}

.btn-outline-primary {
  border-color: #000;
  color: #000;
}

.btn-outline-primary:hover {
  background-color: #000;
  border-color: #000;
  color: #fff;
}

.list-group-item {
  border: 1px solid #e9ecef;
  padding: 1rem;
}

.modal {
  background-color: rgba(0, 0, 0, 0.5);
}

.modal-content {
  border: none;
  border-radius: 0.5rem;
  box-shadow: 0 10px 25px rgba(0, 0, 0, 0.15);
}

.invalid-feedback {
  display: block;
  font-size: 0.875rem;
  color: #dc3545;
  margin-top: 0.25rem;
}

.form-control.is-invalid {
  border-color: #dc3545;
}

.form-control.is-invalid:focus {
  border-color: #dc3545;
  box-shadow: 0 0 0 0.2rem rgba(220, 53, 69, 0.25);
}

.alert {
  border: none;
  border-radius: 0.5rem;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.alert-success {
  background-color: #d1e7dd;
  color: #0f5132;
}

.alert-info {
  background-color: #cff4fc;
  color: #055160;
}

.spinner-border-sm {
  width: 1rem;
  height: 1rem;
}

.list-group-item {
  border: 1px solid #e9ecef;
  padding: 1rem;
  transition: background-color 0.2s ease;
}

.list-group-item:hover {
  background-color: #f8f9fa;
}

.display-4 {
  font-size: 3.5rem;
  font-weight: 300;
  line-height: 1.2;
}

/* Responsive adjustments */
@media (max-width: 768px) {
  .dashboard-title {
    font-size: 1.5rem;
  }
  
  .settings-nav .nav-link {
    padding: 0.5rem 0.75rem;
    font-size: 0.9rem;
  }
  
  .settings-section {
    min-height: auto;
  }
  
  .display-4 {
    font-size: 2.5rem;
  }
}
</style>
