<template>
  <!-- SVG Glitch Effect -->
  <svg style="position: absolute; width: 0; height: 0;">
    <filter id="chaos-glitch">
      <feTurbulence type="fractalNoise" baseFrequency="0.02" numOctaves="3" result="turbulence"/>
      <feDisplacementMap in="SourceGraphic" in2="turbulence" scale="2" xChannelSelector="R" yChannelSelector="G"/>
    </filter>
  </svg>
  <div class="connect-page">
    <div class="container-fluid">
      <div class="row justify-content-center">
        <div class="col-12" style="max-width: 1400px;">
          <div class="onboarding-card">
            <div class="onboarding-header">
              <div class="header-content">
                <div class="text-center">
                  <div class="d-flex flex-column align-items-center justify-content-center">
                    <img src="../assets/CM-icon.png" alt="ChaosMonkey.dev Logo" class="dashboard-logo mb-3">
                    <link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&display=swap" rel="stylesheet">
                    <h1 class="onboarding-title mb-0" style="font-family: 'Bebas Neue'; filter: url(#chaos-glitch);">
                      CHAOSMONKEY
                    </h1>
                  </div>
                  
                  <div class="progress-indicator mb-4 mt-4">
                    <div class="progress-step completed">
                      <div class="step-number">1</div>
                      <div class="step-label">Connect IDEs</div>
                    </div>
                    <div class="progress-connector"></div>
                    <div class="progress-step active">
                      <div class="step-number">2</div>
                      <div class="step-label">Invite Team</div>
                    </div>
                  </div>
                  
                  <h1 class="onboarding-title mb-3">Connect IDEs & Invite Team</h1>
                  <p class="onboarding-subtitle mb-2">Connect your development environments and invite team members to start tracking productivity</p>
                  <p class="mt-2 text-muted small mb-3">
                    Cursor, Windsurf, & VS Code are currently the only IDE with live telemetry; other IDEs use simulated data until their extensions are ready.
                  </p>
                  <div class="text-center mt-3">
                    <a :href="apiUrl + '/api-token/config'" target="_blank" class="btn btn-outline-primary btn-sm">
                      <i class="bi bi-key me-2"></i>
                      Get API Token for Extension
                    </a>
                  </div>
                </div>
              </div>
            </div>
            <div class="onboarding-body">
            <div v-if="isLoading" class="text-center">
              <div class="spinner-border text-primary" role="status">
                <span class="visually-hidden">Loading...</span>
               
              </div>
            </div>
            
            <div v-else class="row g-4 px-2 px-md-3">
              <!-- VS Code IDE Card -->
              <div class="col-12 col-sm-6 col-lg-4 mb-3">
                <div class="cicd-section card h-100">
                  <div class="card-body">
                    <div class="cicd-section-header d-flex flex-column flex-md-row align-items-start align-items-md-center justify-content-between gap-1 mb-3">
                      <div class="d-flex align-items-center">
                        <div class="stage-icon-wrapper me-3 bg-success">
                          <i class="bi bi-code-slash text-white"></i>
                        </div>
                        <div>
                          <h5 class="mb-0 fw-bold">VS Code</h5>
                          <small class="text-muted">Popular code editor</small>
                        </div>
                      </div>
                      <span v-if="ideStatus.vscode.connected" class="badge bg-success-subtle text-success">
                        <i class="bi bi-check-circle-fill me-1"></i>Connected
                      </span>
                    </div>
                    
                    <div v-if="ideStatus.vscode.connected" class="mt-3">
                      <button @click="disconnectIDE('vscode')" class="btn btn-sm btn-outline-danger w-100">
                        <i class="bi bi-x-circle me-2"></i>Disconnect
                      </button>
                    </div>
                    
                    <div v-else>
                      <button 
                        @click="connectVSCode" 
                        class="btn btn-success w-100"
                        :disabled="ideStatus.vscode.connecting"
                      >
                        <span v-if="ideStatus.vscode.connecting" class="spinner-border spinner-border-sm me-2"></span>
                        <i class="bi bi-plug me-2"></i>Connect with SSO
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Cursor IDE Card -->
              <div class="col-12 col-sm-6 col-lg-4 mb-3">
                <div class="cicd-section card h-100">
                  <div class="card-body">
                    <div class="cicd-section-header d-flex flex-column flex-md-row align-items-start align-items-md-center justify-content-between gap-1 mb-3">
                      <div class="d-flex align-items-center">
                        <div class="stage-icon-wrapper me-3 bg-primary">
                          <i class="bi bi-cursor-fill text-white"></i>
                        </div>
                        <div>
                          <h5 class="mb-0 fw-bold">Cursor</h5>
                          <small class="text-muted">AI-powered code editor</small>
                        </div>
                      </div>
                      <span v-if="ideStatus.cursor.connected" class="badge bg-success-subtle text-success">
                        <i class="bi bi-check-circle-fill me-1"></i>Connected
                      </span>
                    </div>
                    
                    <div v-if="ideStatus.cursor.connected" class="mt-3">
                      <button @click="disconnectIDE('cursor')" class="btn btn-sm btn-outline-danger w-100">
                        <i class="bi bi-x-circle me-2"></i>Disconnect
                      </button>
                    </div>
                    
                    <div v-else>
                      <button 
                        @click="connectCursor" 
                        class="btn btn-primary w-100"
                        :disabled="ideStatus.cursor.connecting"
                      >
                        <span v-if="ideStatus.cursor.connecting" class="spinner-border spinner-border-sm me-2"></span>
                        <i class="bi bi-plug me-2"></i>Connect with SSO
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Windsurf IDE Card -->
              <div class="col-12 col-sm-6 col-lg-4 mb-3">
                <div class="cicd-section card h-100">
                  <div class="card-body">
                    <div class="cicd-section-header d-flex flex-column flex-md-row align-items-start align-items-md-center justify-content-between gap-1 mb-3">
                      <div class="d-flex align-items-center">
                        <div class="stage-icon-wrapper me-3 bg-info">
                          <i class="bi bi-wind text-white"></i>
                        </div>
                        <div>
                          <h5 class="mb-0 fw-bold">Windsurf</h5>
                          <small class="text-muted">AI coding assistant</small>
                        </div>
                      </div>
                      <span v-if="ideStatus.windsurf.connected" class="badge bg-success-subtle text-success">
                        <i class="bi bi-check-circle-fill me-1"></i>Connected
                      </span>
                    </div>
                    
                    <div v-if="ideStatus.windsurf.connected" class="mt-3">
                      <button @click="disconnectIDE('windsurf')" class="btn btn-sm btn-outline-danger w-100">
                        <i class="bi bi-x-circle me-2"></i>Disconnect
                      </button>
                    </div>
                    
                    <div v-else>
                      <button 
                        @click="connectWindsurf" 
                        class="btn btn-info w-100"
                        :disabled="ideStatus.windsurf.connecting"
                      >
                        <span v-if="ideStatus.windsurf.connecting" class="spinner-border spinner-border-sm me-2"></span>
                        <i class="bi bi-plug me-2"></i>Connect with SSO
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <!-- JetBrains IDE Card -->
              <div class="col-12 col-sm-6 col-lg-4 mb-3">
                <div class="cicd-section card h-100">
                  <div class="card-body">
                    <div class="cicd-section-header d-flex flex-column flex-md-row align-items-start align-items-md-center justify-content-between gap-1 mb-3">
                      <div class="d-flex align-items-center">
                        <div class="stage-icon-wrapper me-3 bg-warning">
                          <i class="bi bi-tools text-white"></i>
                        </div>
                        <div>
                          <h5 class="mb-0 fw-bold">JetBrains</h5>
                          <small class="text-muted">Professional IDEs</small>
                        </div>
                      </div>
                      <span v-if="ideStatus.jetbrains.connected" class="badge bg-success-subtle text-success">
                        <i class="bi bi-check-circle-fill me-1"></i>Connected
                      </span>
                    </div>
                    
                    <div v-if="ideStatus.jetbrains.connected" class="mt-3">
                      <button @click="disconnectIDE('jetbrains')" class="btn btn-sm btn-outline-danger w-100">
                        <i class="bi bi-x-circle me-2"></i>Disconnect
                      </button>
                    </div>
                    
                    <div v-else>
                      <button 
                        @click="connectJetBrains" 
                        class="btn btn-warning w-100"
                        :disabled="ideStatus.jetbrains.connecting"
                      >
                        <span v-if="ideStatus.jetbrains.connecting" class="spinner-border spinner-border-sm me-2"></span>
                        <i class="bi bi-plug me-2"></i>Connect with SSO
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Claude Code IDE Card -->
              <div class="col-12 col-sm-6 col-lg-4 mb-3">
                <div class="cicd-section card h-100">
                  <div class="card-body">
                    <div class="cicd-section-header d-flex flex-column flex-md-row align-items-start align-items-md-center justify-content-between gap-1 mb-3">
                      <div class="d-flex align-items-center">
                        <div class="stage-icon-wrapper me-3 bg-secondary">
                          <i class="bi bi-robot text-white"></i>
                        </div>
                        <div>
                          <h5 class="mb-0 fw-bold">Claude Code</h5>
                          <small class="text-muted">AI coding assistant</small>
                        </div>
                      </div>
                      <span v-if="ideStatus.claude.connected" class="badge bg-success-subtle text-success">
                        <i class="bi bi-check-circle-fill me-1"></i>Connected
                      </span>
                    </div>
                    
                    <div v-if="ideStatus.claude.connected" class="mt-3">
                      <button @click="disconnectIDE('claude')" class="btn btn-sm btn-outline-danger w-100">
                        <i class="bi bi-x-circle me-2"></i>Disconnect
                      </button>
                    </div>
                    
                    <div v-else>
                      <button 
                        @click="connectClaude" 
                        class="btn btn-secondary w-100"
                        :disabled="ideStatus.claude.connecting"
                      >
                        <span v-if="ideStatus.claude.connecting" class="spinner-border spinner-border-sm me-2"></span>
                        <i class="bi bi-plug me-2"></i>Connect with SSO
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <!-- GitHub Copilot IDE Card -->
              <div class="col-12 col-sm-6 col-lg-4 mb-3">
                <div class="cicd-section card h-100">
                  <div class="card-body">
                    <div class="cicd-section-header d-flex flex-column flex-md-row align-items-start align-items-md-center justify-content-between gap-1 mb-3">
                      <div class="d-flex align-items-center">
                        <div class="stage-icon-wrapper me-3" style="background-color: #24292e;">
                          <i class="bi bi-cpu text-white"></i>
                        </div>
                        <div>
                          <h5 class="mb-0 fw-bold">GitHub Copilot</h5>
                          <small class="text-muted">AI pair programmer</small>
                        </div>
                      </div>
                      <span v-if="ideStatus.copilot.connected" class="badge bg-success-subtle text-success">
                        <i class="bi bi-check-circle-fill me-1"></i>Connected
                      </span>
                    </div>
                    
                    <div v-if="ideStatus.copilot.connected" class="mt-3">
                      <button @click="disconnectIDE('copilot')" class="btn btn-sm btn-outline-danger w-100">
                        <i class="bi bi-x-circle me-2"></i>Disconnect
                      </button>
                    </div>
                    
                    <div v-else>
                      <button 
                        @click="connectCopilot" 
                        class="btn w-100"
                        style="background-color: #24292e; color: white;"
                        :disabled="ideStatus.copilot.connecting"
                      >
                        <span v-if="ideStatus.copilot.connecting" class="spinner-border spinner-border-sm me-2"></span>
                        <i class="bi bi-plug me-2"></i>Connect with SSO
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- AI Tool Costs Section -->
            <div class="row mt-4">
              <div class="col-12">
                <div class="card border-0 shadow-sm">
                  <div class="card-body p-3">
                    <h6 class="mb-1 fw-semibold">AI tool cost inputs</h6>
                    <p class="text-muted mb-3 small">Used for cost-adjusted Productivity by Tool comparisons. You can edit this later from the dashboard.</p>

                    <div class="table-responsive">
                      <table class="table table-sm mb-0">
                        <thead>
                          <tr class="table-light">
                            <th class="py-2">Tool</th>
                            <th class="py-2" style="width: 100px;">Active seats</th>
                            <th class="py-2" style="width: 130px;">Cost / seat / month</th>
                            <th class="py-2" style="width: 110px;">Monthly spend</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr>
                            <td class="py-2">Cursor</td>
                            <td>
                              <input
                                type="number"
                                class="form-control form-control-sm"
                                v-model.number="toolCosts.cursor.seatCount"
                                @blur="saveToolCost('cursor')"
                                placeholder="0"
                                min="0"
                              />
                            </td>
                            <td>
                              <input
                                type="number"
                                class="form-control form-control-sm"
                                v-model.number="toolCosts.cursor.costPerSeatMonthly"
                                @blur="saveToolCost('cursor')"
                                placeholder="0"
                                min="0"
                                step="0.01"
                              />
                            </td>
                            <td class="text-muted py-2 fw-semibold">{{ monthlySpendDisplay('cursor') }}</td>
                          </tr>
                          <tr>
                            <td class="py-2">Devin</td>
                            <td>
                              <input
                                type="number"
                                class="form-control form-control-sm"
                                v-model.number="toolCosts.devin.seatCount"
                                @blur="saveToolCost('devin')"
                                placeholder="0"
                                min="0"
                              />
                            </td>
                            <td>
                              <input
                                type="number"
                                class="form-control form-control-sm"
                                v-model.number="toolCosts.devin.costPerSeatMonthly"
                                @blur="saveToolCost('devin')"
                                placeholder="0"
                                min="0"
                                step="0.01"
                              />
                            </td>
                            <td class="text-muted py-2 fw-semibold">{{ monthlySpendDisplay('devin') }}</td>
                          </tr>
                          <tr>
                            <td class="py-2">VS Code</td>
                            <td>
                              <input
                                type="number"
                                class="form-control form-control-sm"
                                v-model.number="toolCosts.vscode.seatCount"
                                @blur="saveToolCost('vscode')"
                                placeholder="0"
                                min="0"
                              />
                            </td>
                            <td>
                              <input
                                type="number"
                                class="form-control form-control-sm"
                                v-model.number="toolCosts.vscode.costPerSeatMonthly"
                                @blur="saveToolCost('vscode')"
                                placeholder="0"
                                min="0"
                                step="0.01"
                              />
                            </td>
                            <td class="text-muted py-2 fw-semibold">{{ monthlySpendDisplay('vscode') }}</td>
                          </tr>
                          <tr>
                            <td class="py-2">Claude Code</td>
                            <td>
                              <input
                                type="number"
                                class="form-control form-control-sm"
                                v-model.number="toolCosts['claude-code'].seatCount"
                                @blur="saveToolCost('claude-code')"
                                placeholder="0"
                                min="0"
                              />
                            </td>
                            <td>
                              <input
                                type="number"
                                class="form-control form-control-sm"
                                v-model.number="toolCosts['claude-code'].costPerSeatMonthly"
                                @blur="saveToolCost('claude-code')"
                                placeholder="0"
                                min="0"
                                step="0.01"
                              />
                            </td>
                            <td class="text-muted py-2 fw-semibold">{{ monthlySpendDisplay('claude-code') }}</td>
                          </tr>
                          <tr>
                            <td class="py-2">GitHub Copilot</td>
                            <td>
                              <input
                                type="number"
                                class="form-control form-control-sm"
                                v-model.number="toolCosts['github-copilot'].seatCount"
                                @blur="saveToolCost('github-copilot')"
                                placeholder="0"
                                min="0"
                              />
                            </td>
                            <td>
                              <input
                                type="number"
                                class="form-control form-control-sm"
                                v-model.number="toolCosts['github-copilot'].costPerSeatMonthly"
                                @blur="saveToolCost('github-copilot')"
                                placeholder="0"
                                min="0"
                                step="0.01"
                              />
                            </td>
                            <td class="text-muted py-2 fw-semibold">{{ monthlySpendDisplay('github-copilot') }}</td>
                          </tr>
                          <tr>
                            <td class="py-2">Codex</td>
                            <td>
                              <input
                                type="number"
                                class="form-control form-control-sm"
                                v-model.number="toolCosts.codex.seatCount"
                                @blur="saveToolCost('codex')"
                                placeholder="0"
                                min="0"
                              />
                            </td>
                            <td>
                              <input
                                type="number"
                                class="form-control form-control-sm"
                                v-model.number="toolCosts.codex.costPerSeatMonthly"
                                @blur="saveToolCost('codex')"
                                placeholder="0"
                                min="0"
                                step="0.01"
                              />
                            </td>
                            <td class="text-muted py-2 fw-semibold">{{ monthlySpendDisplay('codex') }}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>

                    <div class="d-flex justify-content-end gap-2 mt-3">
                      <button @click="saveAllCosts" class="btn btn-sm btn-primary">
                        <i class="bi bi-save me-1"></i>Save costs
                      </button>
                      <button @click="clearAllCosts" class="btn btn-sm btn-outline-secondary">
                        <i class="bi bi-trash me-1"></i>Clear costs
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- Team Invites Section -->
            <div class="row mt-5">
              <div class="col-12">
                <div class="onboarding-card">
                  <div class="card-body p-4">
                    <div class="text-center mb-4">
                      <div style="width: 80px; height: 80px; margin: 0 auto; background: linear-gradient(135deg, #667eea, #764ba2); border-radius: 20px; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);">
                        <i class="bi bi-people-fill text-white" style="font-size: 40px;"></i>
                      </div>
                      <h6 class="mt-3 text-muted">Invite Team Members</h6>
                    </div>
                    
                    <p class="text-muted mb-4 text-center">
                      Generate invite links or send email invitations to bring developers to your organization.
                    </p>
                    
                    <!-- Team Invites Section - Temporarily Disabled for MVP2 Pilots -->
                    <div class="card border-0 shadow-sm mb-4">
                      <div class="card-body">
                        <h5 class="card-title mb-3">Team Invitations</h5>
                        <div class="alert alert-info">
                          <h6 class="alert-heading">
                            <i class="bi bi-info-circle me-2"></i>
                            Manual Invitations for MVP2 Pilots
                          </h6>
                          <p class="mb-2">
                            Team invitations are temporarily manual for pilot rollout.
                          </p>
                          <p class="mb-0">
                            Download the extension and send developers the Pilot API base URL:
                            <code>{{ apiUrl }}</code>
                          </p>
                          <p class="mb-0 mt-2">
                            <strong>Developers do not need dashboard access</strong> — they only need the extension configured with the API base URL.
                          </p>
                        </div>
                      </div>
                    </div>

                    
                    <!-- IDE Connect Code Section - HIDDEN FOR NOW -->
                    <!--
                    <div class="mt-4 pt-4 border-top">
                      <h6 class="mb-3">
                        <i class="bi bi-plug me-2"></i>
                        IDE Connect Code
                      </h6>
                      <p class="text-muted small mb-3">
                        Generate a one-time code for developers to connect their IDE extensions.
                      </p>
                      
                      <button
                        @click="generateConnectCode"
                        :disabled="generatingCode"
                        class="btn btn-info text-white mb-3"
                      >
                        <span v-if="generatingCode" class="spinner-border spinner-border-sm me-2"></span>
                        <i class="bi bi-key me-2"></i>
                        <span v-if="generatingCode">Generating...</span>
                        <span v-else>Generate Connect Code</span>
                      </button>

                      <div v-if="connectCode" class="alert alert-info">
                        <h6 class="alert-heading">
                          <i class="bi bi-key-fill me-2"></i>
                          Connect Code
                        </h6>
                        <div class="text-center mb-3">
                          <div class="display-6 font-monospace fw-bold text-primary">
                            {{ connectCode.code }}
                          </div>
                          <div class="small text-muted">
                            Expires in {{ connectCode.expires_in_minutes }} minutes
                          </div>
                          <div v-if="connectCode.note" class="small text-warning mt-2">
                            <i class="bi bi-info-circle me-1"></i>
                            {{ connectCode.note }}
                          </div>
                        </div>
                        <div class="d-flex justify-content-between align-items-center">
                          <small class="text-muted">
                            <strong>How to use:</strong>
                          </small>
                          <button class="btn btn-sm btn-outline-secondary" @click="copyConnectCode">
                            <i class="bi bi-clipboard me-1"></i>Copy Code
                          </button>
                        </div>
                        <ol class="small text-muted mt-2 mb-0">
                          <li>Open your IDE (VS Code, Cursor, etc.)</li>
                          <li>Run "ChaosMonkey: Connect" command</li>
                          <li>Enter this code when prompted</li>
                        </ol>
                      </div>
                    </div>
                    -->
                  </div>
                </div>
              </div>
            </div>

            <!-- Continue Button - Deprecated for MVP2 pilots -->
            <div class="text-center mt-5">
              <div class="alert alert-info">
                <h6 class="alert-heading">
                  <i class="bi bi-info-circle me-2"></i>
                  Onboarding Flow Deprecated
                </h6>
                <p class="mb-2">
                  The IDE connection and metric selection onboarding flow is no longer required for MVP2 pilots.
                </p>
                <p class="mb-0">
                  Please use the <strong>Pilot Setup</strong> section in the dashboard to configure your extension and API settings.
                </p>
              </div>
              <button 
                @click="goToDashboards" 
                class="btn btn-primary btn-lg"
              >
                Go to Dashboards
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { useIDEStore } from '../stores/ide'
import { getToolCostConfig, saveOrgToolCostConfig, clearOrgToolCostConfig, clearAllOrgToolCostConfigs, fetchOrgToolCostConfigsWithAuthority, costMonthlySpendDisplay } from '@/lib/toolCost'
import api, { API_ENDPOINTS } from '../config/api'
import { sessionManager } from '../utils/sessionStorage.js'

const router = useRouter()
const route = useRoute()
const authStore = useAuthStore()
const ideStore = useIDEStore()

// Base API URL for links (production-safe, never hardcodes loopback)
const apiUrl = computed(() => {
  const base = import.meta.env.VITE_API_BASE_URL
  if (base && !/^https?:\/\/127\./.test(base)) {
    return `${base.replace(/\/$/, '')}/api`
  }
  return import.meta.env.DEV ? 'http://' + window.location.hostname + ':8010/api' : `${window.location.origin}/api`
})

// Reactive state
const isLoading = ref(false)

const ideStatus = ref({
  cursor: { connected: false, connecting: false },
  windsurf: { connected: false, connecting: false },
  vscode: { connected: false, connecting: false },
  jetbrains: { connected: false, connecting: false },
  claude: { connected: false, connecting: false },
  copilot: { connected: false, connecting: false }
})

// Invite and Connect Code state
const generatingInvite = ref(false)
const generatingCode = ref(false)
const invite = ref(null)
const connectCode = ref(null)
const inviteEmail = ref('')
const inviteExpires = ref('24')

// Email invite form (matching settings page)
const settingsInviteForm = ref({
  email: '',
  role: 'member'
})
const settingsInviteFormErrors = ref({
  email: ''
})
const isSendingInvite = ref(false)

// Tool costs state - seat-based config
const toolCosts = ref({
  cursor: { seatCount: 0, costPerSeatMonthly: 0 },
  devin: { seatCount: 0, costPerSeatMonthly: 0 },
  vscode: { seatCount: 0, costPerSeatMonthly: 0 },
  'claude-code': { seatCount: 0, costPerSeatMonthly: 0 },
  'github-copilot': { seatCount: 0, costPerSeatMonthly: 0 },
  codex: { seatCount: 0, costPerSeatMonthly: 0 }
})

// Persisted tool IDs (row existence = configured). Absent ≠ configured $0.
// Includes explicit zero-spend rows so they render "$0.00", not "Not configured".
const persistedCostToolIds = ref(new Set())

const monthlySpendDisplay = (toolId) => {
  const config = toolCosts.value[toolId]
  return costMonthlySpendDisplay({
    persisted: persistedCostToolIds.value.has(toolId),
    seatCount: config?.seatCount ?? 0,
    costPerSeatMonthly: config?.costPerSeatMonthly ?? 0
  })
}

// CR-X ECON-1: Load tool cost configs from backend authority on mount
onMounted(async () => {
  const tools = ['cursor', 'devin', 'vscode', 'claude-code', 'github-copilot', 'codex']
  try {
    const result = await fetchOrgToolCostConfigsWithAuthority()
    const byTool = new Map()
    for (const c of result.configs) {
      byTool.set(c.toolId, c)
    }
    persistedCostToolIds.value = new Set(result.configs.map(c => c.toolId))
    if (result.authority === 'backend_unavailable') {
      // localStorage fallback: a stored config (incl. explicit zero) is persisted
      tools.forEach(toolId => {
        if (getToolCostConfig(toolId)) persistedCostToolIds.value.add(toolId)
      })
    }
    tools.forEach(toolId => {
      const config = byTool.get(toolId)
      if (config) {
        toolCosts.value[toolId] = {
          seatCount: config.seatCount || 0,
          costPerSeatMonthly: config.costPerSeatMonthly || 0
        }
      }
    })
  } catch {
    // backend_unavailable: graceful degradation to localStorage fallback
    const stored = new Set()
    tools.forEach(toolId => {
      const config = getToolCostConfig(toolId)
      if (config) {
        stored.add(toolId)
        toolCosts.value[toolId] = {
          seatCount: config.seatCount,
          costPerSeatMonthly: config.costPerSeatMonthly
        }
      }
    })
    persistedCostToolIds.value = stored
  }
})

// CR-X ECON-1: Save tool cost config to backend authority
const saveToolCost = async (toolId) => {
  const config = toolCosts.value[toolId]
  if (config && (config.seatCount > 0 || config.costPerSeatMonthly > 0)) {
    const saved = await saveOrgToolCostConfig(toolId, {
      seatCount: config.seatCount,
      costPerSeatMonthly: config.costPerSeatMonthly
    })
    if (saved) persistedCostToolIds.value.add(toolId)
  } else {
    const cleared = await clearOrgToolCostConfig(toolId)
    if (cleared) persistedCostToolIds.value.delete(toolId)
  }
}

// Save all costs
const saveAllCosts = async () => {
  const tools = Object.keys(toolCosts.value)
  await Promise.all(tools.map(toolId => saveToolCost(toolId)))
}

// Clear all costs
const clearAllCosts = async () => {
  const ok = await clearAllOrgToolCostConfigs()
  if (ok) persistedCostToolIds.value = new Set()
  Object.keys(toolCosts.value).forEach(toolId => {
    toolCosts.value[toolId] = { seatCount: 0, costPerSeatMonthly: 0 }
  })
}

// Computed properties
const canContinue = computed(() => {
  return ideStatus.value.cursor.connected || 
         ideStatus.value.windsurf.connected || 
         ideStatus.value.vscode.connected ||
         ideStatus.value.jetbrains.connected ||
         ideStatus.value.claude.connected ||
         ideStatus.value.copilot.connected
})

const inviteLink = computed(() => {
  return invite.value ? `${window.location.origin}/invite/${invite.value.token}` : ''
})

// Methods
const logout = async () => {
  await authStore.logout()
  router.push('/login')
}

const connectCursor = async () => {
  ideStatus.value.cursor.connecting = true
  try {
    const result = await authenticateCursor()
    if (result.success) {
      ideStatus.value.cursor.connected = true
      ideStore.updateIDEStatus('cursor', true)
      // Save connection state and user info (if available)
      sessionManager.saveIDEConnection('cursor', {
        connected: true,
        provider: result.provider,
        user: result.user || null,
        message: result.message || '',
      })
    }
  } catch (error) {
    console.error('Failed to connect Cursor:', error)
    alert('Failed to connect Cursor.')
  } finally {
    ideStatus.value.cursor.connecting = false
  }
}

const connectWindsurf = async () => {
  ideStatus.value.windsurf.connecting = true
  try {
    const result = await authenticateWindsurf()
    if (result.success) {
      ideStatus.value.windsurf.connected = true
      ideStore.updateIDEStatus('windsurf', true)
      sessionManager.saveIDEConnection('windsurf', {
        connected: true,
        provider: result.provider,
        user: result.user || null,
        message: result.message || '',
      })
    }
  } catch (error) {
    console.error('Failed to connect Windsurf:', error)
    alert('Failed to connect Windsurf.')
  } finally {
    ideStatus.value.windsurf.connecting = false
  }
}

const connectVSCode = async () => {
  ideStatus.value.vscode.connecting = true
  try {
    const result = await authenticateVSCode()
    if (result.success) {
      ideStatus.value.vscode.connected = true
      ideStore.updateIDEStatus('vscode', true)
      sessionManager.saveIDEConnection('vscode', {
        connected: true,
        provider: result.provider,
        user: result.user || null,
        message: result.message || '',
      })
    }
  } catch (error) {
    console.error('Failed to connect VS Code:', error)
    alert('Failed to connect VS Code.')
  } finally {
    ideStatus.value.vscode.connecting = false
  }
}

const connectJetBrains = async () => {
  ideStatus.value.jetbrains.connecting = true
  try {
    const result = await authenticateJetBrains()
    if (result.success) {
      ideStatus.value.jetbrains.connected = true
      ideStore.updateIDEStatus('jetbrains', true)
      sessionManager.saveIDEConnection('jetbrains', {
        connected: true,
        provider: result.provider,
        user: result.user || null,
        message: result.message || '',
      })
    }
  } catch (error) {
    console.error('Failed to connect JetBrains:', error)
    alert('Failed to connect JetBrains.')
  } finally {
    ideStatus.value.jetbrains.connecting = false
  }
}

const connectClaude = async () => {
  ideStatus.value.claude.connecting = true
  try {
    const result = await authenticateClaude()
    if (result.success) {
      ideStatus.value.claude.connected = true
      ideStore.updateIDEStatus('claude', true)
      sessionManager.saveIDEConnection('claude', {
        connected: true,
        provider: result.provider,
        user: result.user || null,
        message: result.message || '',
      })
    }
  } catch (error) {
    console.error('Failed to connect Claude:', error)
    alert('Failed to connect Claude.')
  } finally {
    ideStatus.value.claude.connecting = false
  }
}

const connectCopilot = async () => {
  ideStatus.value.copilot.connecting = true
  try {
    const result = await authenticateCopilot()
    if (result.success) {
      ideStatus.value.copilot.connected = true
      ideStore.updateIDEStatus('copilot', true)
      sessionManager.saveIDEConnection('copilot', {
        connected: true,
        provider: result.provider,
        user: result.user || null,
        message: result.message || '',
      })
    }
  } catch (error) {
    console.error('Failed to connect Copilot:', error)
    alert('Failed to connect Copilot.')
  } finally {
    ideStatus.value.copilot.connecting = false
  }
}

const disconnectIDE = async (ideName) => {
  try {
    await api.post(API_ENDPOINTS.IDE_DISCONNECT, { ide: ideName })
    ideStatus.value[ideName].connected = false
    // Update store
    ideStore.updateIDEStatus(ideName, false)
    // Remove from session
    sessionManager.saveIDEConnection(ideName, { connected: false })
  } catch (error) {
    console.error(`Failed to disconnect ${ideName}:`, error)
    alert(`Failed to disconnect ${ideName}.`)
  }
}

const continueToMetrics = () => {
  // Mark connect step as completed
  sessionStorage.setItem('codesight_onboarding_connect', 'true')
  router.push('/metrics')
}

const skipConnection = () => {
  // Mark connect as skipped (allow access to metrics/dashboards)
  sessionStorage.setItem('codesight_onboarding_connect', 'skipped')
  router.push('/dashboards')
}

const loadIDEStatus = async () => {
  isLoading.value = true
  try {
    // Load from session/localStorage only
    const savedConnections = sessionManager.getIDEConnections()
    Object.keys(ideStatus.value).forEach(ide => {
      if (savedConnections[ide]) {
        ideStatus.value[ide].connected = !!savedConnections[ide].connected
        ideStatus.value[ide].user = savedConnections[ide].user || null
      } else {
        ideStatus.value[ide].connected = false
        ideStatus.value[ide].user = null
      }
    })
    // (API call removed to avoid overwriting localStorage state)
  } catch (error) {
    console.error('Failed to load IDE status:', error)
  } finally {
    isLoading.value = false
  }
}

// SSO Authentication Functions
const authenticateCursor = () => {
  return new Promise((resolve) => {
    const modal = createCursorLoginModal(resolve)
    document.body.appendChild(modal)
  })
}

const authenticateWindsurf = () => {
  return new Promise((resolve) => {
    const modal = createWindsurfLoginModal(resolve)
    document.body.appendChild(modal)
  })
}

const authenticateVSCode = () => {
  return new Promise((resolve) => {
    const modal = createVSCodeLoginModal(resolve)
    document.body.appendChild(modal)
  })
}

const authenticateJetBrains = () => {
  return new Promise((resolve) => {
    const modal = createJetBrainsLoginModal(resolve)
    document.body.appendChild(modal)
  })
}

const authenticateClaude = () => {
  return new Promise((resolve) => {
    const modal = createClaudeLoginModal(resolve)
    document.body.appendChild(modal)
  })
}

const authenticateCopilot = () => {
  return new Promise((resolve) => {
    const modal = createCopilotLoginModal(resolve)
    document.body.appendChild(modal)
  })
}

// Modal Creation Functions
function createCursorLoginModal(resolveCallback) {
  const modal = document.createElement('div')
  modal.className = 'modal show d-block'
  modal.style.backgroundColor = 'rgba(0,0,0,0.7)'
  modal.innerHTML = `
    <div class="modal-dialog modal-dialog-centered modal-lg">
      <div class="modal-content">
        <div class="modal-header bg-primary text-white">
          <div class="d-flex align-items-center">
            <i class="bi bi-cursor-fill me-2 fs-4"></i>
            <h5 class="modal-title mb-0">Sign in to Cursor</h5>
          </div>
          <button type="button" class="btn-close btn-close-white" onclick="this.closest('.modal').remove()"></button>
        </div>
        <div class="modal-body p-4">
          <div class="text-center mb-4">
            <div style="width: 80px; height: 80px; margin: 0 auto; background: linear-gradient(135deg, #0d6efd, #0b5ed7); border-radius: 20px; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 12px rgba(13,110,253,0.3);">
              <i class="bi bi-cursor-fill text-white" style="font-size: 40px;"></i>
            </div>
            <h6 class="mt-3 text-muted">Connect with Cursor</h6>
          </div>
          
          <!-- Optional Organization Information -->
          <div class="card bg-light mb-4">
            <div class="card-body">
              <h6 class="card-title mb-3">
                <i class="bi bi-building me-2"></i>
                Organization Information (Optional)
              </h6>
              <div class="row">
                <div class="col-md-6">
                  <div class="mb-3">
                    <label for="cursor-monthly-spend" class="form-label">Monthly Spend ($)</label>
                    <input type="number" class="form-control" id="cursor-monthly-spend" placeholder="e.g., 29" min="0" step="0.01">
                    <small class="text-muted">Helps us understand your organization size</small>
                  </div>
                </div>
                <div class="col-md-6">
                  <div class="mb-3">
                    <label for="cursor-active-users" class="form-label">Active Users</label>
                    <input type="number" class="form-control" id="cursor-active-users" placeholder="e.g., 10" min="1">
                    <small class="text-muted">Number of developers using this IDE</small>
                  </div>
                </div>
              </div>
            </div>
          </div>
          
          <div class="d-grid gap-3">
            <button type="button" class="btn btn-outline-dark btn-lg" id="github-cursor-btn">
              <i class="bi bi-github me-2"></i>
              Continue with GitHub
            </button>
            <button type="button" class="btn btn-outline-danger btn-lg" id="google-cursor-btn">
              <i class="bi bi-google me-2"></i>
              Continue with Google
            </button>
            <button type="button" class="btn btn-outline-primary btn-lg" id="email-cursor-btn">
              <i class="bi bi-envelope me-2"></i>
              Continue with Email
            </button>
          </div>
          
          <div class="text-center mt-4">
            <small class="text-muted">
              <i class="bi bi-shield-check me-1"></i>
              Uses secure OAuth 2.0 authentication
            </small>
          </div>
        </div>
      </div>
    </div>
  `
  
  setupCursorLoginHandlers(modal, resolveCallback)
  return modal
}

function createWindsurfLoginModal(resolveCallback) {
  const modal = document.createElement('div')
  modal.className = 'modal show d-block'
  modal.style.backgroundColor = 'rgba(0,0,0,0.7)'
  modal.innerHTML = `
    <div class="modal-dialog modal-dialog-centered modal-lg">
      <div class="modal-content">
        <div class="modal-header bg-info text-white">
          <div class="d-flex align-items-center">
            <i class="bi bi-wind me-2 fs-4"></i>
            <h5 class="modal-title mb-0">Sign in to Windsurf</h5>
          </div>
          <button type="button" class="btn-close btn-close-white" onclick="this.closest('.modal').remove()"></button>
        </div>
        <div class="modal-body p-4">
          <div class="text-center mb-4">
            <div style="width: 80px; height: 80px; margin: 0 auto; background: linear-gradient(135deg, #17a2b8, #138496); border-radius: 20px; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 12px rgba(23,162,184,0.3);">
              <i class="bi bi-wind text-white" style="font-size: 40px;"></i>
            </div>
            <h6 class="mt-3 text-muted">Connect with Codeium/Windsurf</h6>
          </div>
          
          <!-- Optional Organization Information -->
          <div class="card bg-light mb-4">
            <div class="card-body">
              <h6 class="card-title mb-3">
                <i class="bi bi-building me-2"></i>
                Organization Information (Optional)
              </h6>
              <div class="row">
                <div class="col-md-6">
                  <div class="mb-3">
                    <label for="windsurf-monthly-spend" class="form-label">Monthly Spend ($)</label>
                    <input type="number" class="form-control" id="windsurf-monthly-spend" placeholder="e.g., 29" min="0" step="0.01">
                    <small class="text-muted">Helps us understand your organization size</small>
                  </div>
                </div>
                <div class="col-md-6">
                  <div class="mb-3">
                    <label for="windsurf-active-users" class="form-label">Active Users</label>
                    <input type="number" class="form-control" id="windsurf-active-users" placeholder="e.g., 10" min="1">
                    <small class="text-muted">Number of developers using this IDE</small>
                  </div>
                </div>
              </div>
            </div>
          </div>
          
          <div class="d-grid gap-3">
            <button type="button" class="btn btn-outline-dark btn-lg" id="github-windsurf-btn">
              <i class="bi bi-github me-2"></i>
              Continue with GitHub
            </button>
            <button type="button" class="btn btn-outline-danger btn-lg" id="google-windsurf-btn">
              <i class="bi bi-google me-2"></i>
              Continue with Google
            </button>
            <button type="button" class="btn btn-outline-primary btn-lg" id="email-windsurf-btn">
              <i class="bi bi-envelope me-2"></i>
              Continue with Email
            </button>
          </div>
          
          <div class="text-center mt-4">
            <small class="text-muted">
              <i class="bi bi-shield-check me-1"></i>
              Uses secure OAuth 2.0 authentication
            </small>
          </div>
        </div>
      </div>
    </div>
  `
  
  setupWindsurfLoginHandlers(modal, resolveCallback)
  return modal
}

function createVSCodeLoginModal(resolveCallback) {
  const modal = document.createElement('div')
  modal.className = 'modal show d-block'
  modal.style.backgroundColor = 'rgba(0,0,0,0.7)'
  modal.innerHTML = `
    <div class="modal-dialog modal-dialog-centered modal-lg">
      <div class="modal-content">
        <div class="modal-header bg-success text-white">
          <div class="d-flex align-items-center">
            <i class="bi bi-code-square me-2 fs-4"></i>
            <h5 class="modal-title mb-0">Sign in to VS Code</h5>
          </div>
          <button type="button" class="btn-close btn-close-white" onclick="this.closest('.modal').remove()"></button>
        </div>
        <div class="modal-body p-4">
          <div class="text-center mb-4">
            <div style="width: 80px; height: 80px; margin: 0 auto; background: linear-gradient(135deg, #28a745, #1e7e34); border-radius: 20px; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 12px rgba(40,167,69,0.3);">
              <i class="bi bi-code-square text-white" style="font-size: 40px;"></i>
            </div>
            <h6 class="mt-3 text-muted">Authenticate with Microsoft</h6>
          </div>
          
          <!-- Optional Organization Information -->
          <div class="card bg-light mb-4">
            <div class="card-body">
              <h6 class="card-title mb-3">
                <i class="bi bi-building me-2"></i>
                Organization Information (Optional)
              </h6>
              <div class="row">
                <div class="col-md-6">
                  <div class="mb-3">
                    <label for="vscode-monthly-spend" class="form-label">Monthly Spend ($)</label>
                    <input type="number" class="form-control" id="vscode-monthly-spend" placeholder="e.g., 29" min="0" step="0.01">
                    <small class="text-muted">Helps us understand your organization size</small>
                  </div>
                </div>
                <div class="col-md-6">
                  <div class="mb-3">
                    <label for="vscode-active-users" class="form-label">Active Users</label>
                    <input type="number" class="form-control" id="vscode-active-users" placeholder="e.g., 10" min="1">
                    <small class="text-muted">Number of developers using this IDE</small>
                  </div>
                </div>
              </div>
            </div>
          </div>
          
          <div class="d-grid gap-3">
            <button type="button" class="btn btn-primary btn-lg shadow-sm" id="microsoft-vscode-btn">
              <i class="bi bi-microsoft me-2"></i>
              Sign in with Microsoft
            </button>
            <button type="button" class="btn btn-outline-dark btn-lg" id="github-vscode-btn">
              <i class="bi bi-github me-2"></i>
              Sign in with GitHub
            </button>
          </div>
          
          <div class="alert alert-warning mt-4" role="alert">
            <small>
              <i class="bi bi-info-circle me-1"></i>
              <strong>Extension Installation:</strong> This will install the ChaosMonkey extension in VS Code for telemetry collection.
            </small>
          </div>
          
          <div class="text-center">
            <small class="text-muted">
              <i class="bi bi-shield-check me-1"></i>
              Uses Microsoft's secure OAuth 2.0 authentication
            </small>
          </div>
        </div>
      </div>
    </div>
  `
  
  setupVSCodeLoginHandlers(modal, resolveCallback)
  return modal
}

function createJetBrainsLoginModal(resolveCallback) {
  const modal = document.createElement('div')
  modal.className = 'modal show d-block'
  modal.style.backgroundColor = 'rgba(0,0,0,0.7)'
  modal.innerHTML = `
    <div class="modal-dialog modal-dialog-centered modal-lg">
      <div class="modal-content">
        <div class="modal-header bg-warning text-white">
          <div class="d-flex align-items-center">
            <i class="bi bi-tools me-2 fs-4"></i>
            <h5 class="modal-title mb-0">Sign in to JetBrains IDEs</h5>
          </div>
          <button type="button" class="btn-close btn-close-white" onclick="this.closest('.modal').remove()"></button>
        </div>
        <div class="modal-body p-4">
          <div class="text-center mb-4">
            <div style="width: 80px; height: 80px; margin: 0 auto; background: linear-gradient(135deg, #ffc107, #e0a800); border-radius: 20px; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 12px rgba(255,193,7,0.3);">
              <i class="bi bi-tools text-white" style="font-size: 40px;"></i>
            </div>
            <h6 class="mt-3 text-muted">Connect with JetBrains Account</h6>
          </div>
          
          <!-- Optional Organization Information -->
          <div class="card bg-light mb-4">
            <div class="card-body">
              <h6 class="card-title mb-3">
                <i class="bi bi-building me-2"></i>
                Organization Information (Optional)
              </h6>
              <div class="row">
                <div class="col-md-6">
                  <div class="mb-3">
                    <label for="jetbrains-monthly-spend" class="form-label">Monthly Spend ($)</label>
                    <input type="number" class="form-control" id="jetbrains-monthly-spend" placeholder="e.g., 49" min="0" step="0.01">
                    <small class="text-muted">Helps us understand your organization size</small>
                  </div>
                </div>
                <div class="col-md-6">
                  <div class="mb-3">
                    <label for="jetbrains-active-users" class="form-label">Active Users</label>
                    <input type="number" class="form-control" id="jetbrains-active-users" placeholder="e.g., 15" min="1">
                    <small class="text-muted">Number of developers using this IDE</small>
                  </div>
                </div>
              </div>
            </div>
          </div>
          
          <div class="d-grid gap-3">
            <button type="button" class="btn btn-warning btn-lg shadow-sm" id="jetbrains-sso-btn">
              <i class="bi bi-tools me-2"></i>
              Sign in with JetBrains Account
            </button>
            <button type="button" class="btn btn-outline-dark btn-lg" id="github-jetbrains-btn">
              <i class="bi bi-github me-2"></i>
              Sign in with GitHub
            </button>
          </div>
          
          <div class="alert alert-warning mt-4" role="alert">
            <small>
              <i class="bi bi-info-circle me-1"></i>
              <strong>Plugin Installation:</strong> This will install the ChaosMonkey plugin in your JetBrains IDE for telemetry collection.
            </small>
          </div>
          
          <div class="text-center">
            <small class="text-muted">
              <i class="bi bi-shield-check me-1"></i>
              Supports IntelliJ IDEA, PyCharm, WebStorm, and other JetBrains IDEs
            </small>
          </div>
        </div>
      </div>
    </div>
  `
  
  setupJetBrainsLoginHandlers(modal, resolveCallback)
  return modal
}

function createClaudeLoginModal(resolveCallback) {
  const modal = document.createElement('div')
  modal.className = 'modal show d-block'
  modal.style.backgroundColor = 'rgba(0,0,0,0.7)'
  modal.innerHTML = `
    <div class="modal-dialog modal-dialog-centered modal-lg">
      <div class="modal-content">
        <div class="modal-header bg-secondary text-white">
          <div class="d-flex align-items-center">
            <i class="bi bi-robot me-2 fs-4"></i>
            <h5 class="modal-title mb-0">Sign in to Claude Code</h5>
          </div>
          <button type="button" class="btn-close btn-close-white" onclick="this.closest('.modal').remove()"></button>
        </div>
        <div class="modal-body p-4">
          <div class="text-center mb-4">
            <div style="width: 80px; height: 80px; margin: 0 auto; background: linear-gradient(135deg, #6c757d, #5a6268); border-radius: 20px; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 12px rgba(108,117,125,0.3);">
              <i class="bi bi-robot text-white" style="font-size: 40px;"></i>
            </div>
            <h6 class="mt-3 text-muted">Connect with Claude Code</h6>
          </div>
          
          <!-- Optional Organization Information -->
          <div class="card bg-light mb-4">
            <div class="card-body">
              <h6 class="card-title mb-3">
                <i class="bi bi-building me-2"></i>
                Organization Information (Optional)
              </h6>
              <div class="row">
                <div class="col-md-6">
                  <div class="mb-3">
                    <label for="claude-monthly-spend" class="form-label">Monthly Spend ($)</label>
                    <input type="number" class="form-control" id="claude-monthly-spend" placeholder="e.g., 20" min="0" step="0.01">
                    <small class="text-muted">Helps us understand your organization size</small>
                  </div>
                </div>
                <div class="col-md-6">
                  <div class="mb-3">
                    <label for="claude-active-users" class="form-label">Active Users</label>
                    <input type="number" class="form-control" id="claude-active-users" placeholder="e.g., 8" min="1">
                    <small class="text-muted">Number of developers using this IDE</small>
                  </div>
                </div>
              </div>
            </div>
          </div>
          
          <div class="d-grid gap-3">
            <button type="button" class="btn btn-secondary btn-lg shadow-sm" id="anthropic-claude-btn">
              <i class="bi bi-robot me-2"></i>
              Sign in with Anthropic
            </button>
            <button type="button" class="btn btn-outline-dark btn-lg" id="github-claude-btn">
              <i class="bi bi-github me-2"></i>
              Sign in with GitHub
            </button>
          </div>
          
          <div class="alert alert-warning mt-4" role="alert">
            <small>
              <i class="bi bi-info-circle me-1"></i>
              <strong>Extension Installation:</strong> This will install the ChaosMonkey extension in Claude Code for telemetry collection.
            </small>
          </div>
          
          <div class="text-center">
            <small class="text-muted">
              <i class="bi bi-shield-check me-1"></i>
              Uses Anthropic's secure authentication system
            </small>
          </div>
        </div>
      </div>
    </div>
  `
  
  setupClaudeLoginHandlers(modal, resolveCallback)
  return modal
}

function createCopilotLoginModal(resolveCallback) {
  const modal = document.createElement('div')
  modal.className = 'modal show d-block'
  modal.style.backgroundColor = 'rgba(0,0,0,0.7)'
  modal.innerHTML = `
    <div class="modal-dialog modal-dialog-centered modal-lg">
      <div class="modal-content">
        <div class="modal-header text-white" style="background-color: #24292e;">
          <div class="d-flex align-items-center">
            <i class="bi bi-cpu me-2 fs-4"></i>
            <h5 class="modal-title mb-0">Sign in to GitHub Copilot</h5>
          </div>
          <button type="button" class="btn-close btn-close-white" onclick="this.closest('.modal').remove()"></button>
        </div>
        <div class="modal-body p-4">
          <div class="text-center mb-4">
            <div style="width: 80px; height: 80px; margin: 0 auto; background: linear-gradient(135deg, #24292e, #1a1e22); border-radius: 20px; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 12px rgba(36,41,46,0.3);">
              <i class="bi bi-cpu text-white" style="font-size: 40px;"></i>
            </div>
            <h6 class="mt-3 text-muted">Connect with GitHub Copilot</h6>
          </div>
          
          <!-- Optional Organization Information -->
          <div class="card bg-light mb-4">
            <div class="card-body">
              <h6 class="card-title mb-3">
                <i class="bi bi-building me-2"></i>
                Organization Information (Optional)
              </h6>
              <div class="row">
                <div class="col-md-6">
                  <div class="mb-3">
                    <label for="copilot-monthly-spend" class="form-label">Monthly Spend ($)</label>
                    <input type="number" class="form-control" id="copilot-monthly-spend" placeholder="e.g., 10" min="0" step="0.01">
                    <small class="text-muted">Helps us understand your organization size</small>
                  </div>
                </div>
                <div class="col-md-6">
                  <div class="mb-3">
                    <label for="copilot-active-users" class="form-label">Active Users</label>
                    <input type="number" class="form-control" id="copilot-active-users" placeholder="e.g., 12" min="1">
                    <small class="text-muted">Number of developers using this IDE</small>
                  </div>
                </div>
              </div>
            </div>
          </div>
          
          <div class="d-grid gap-3">
            <button type="button" class="btn btn-lg shadow-sm" id="microsoft-copilot-btn" style="background-color: #24292e; color: white;">
              <i class="bi bi-microsoft me-2"></i>
              Sign in with Microsoft
            </button>
            <button type="button" class="btn btn-outline-dark btn-lg" id="github-copilot-btn">
              <i class="bi bi-github me-2"></i>
              Sign in with GitHub
            </button>
          </div>
          
          <div class="alert alert-warning mt-4" role="alert">
            <small>
              <i class="bi bi-info-circle me-1"></i>
              <strong>Extension Installation:</strong> This will install the ChaosMonkey extension for GitHub Copilot integration.
            </small>
          </div>
          
          <div class="text-center">
            <small class="text-muted">
              <i class="bi bi-shield-check me-1"></i>
              Uses GitHub's secure OAuth authentication system
            </small>
          </div>
        </div>
      </div>
    </div>
  `
  
  setupCopilotLoginHandlers(modal, resolveCallback)
  return modal
}

// Event Handler Setup Functions
function setupCursorLoginHandlers(modal, resolveCallback) {
  const githubBtn = modal.querySelector('#github-cursor-btn')
  const googleBtn = modal.querySelector('#google-cursor-btn')
  const emailBtn = modal.querySelector('#email-cursor-btn')
  
  const getFormData = () => {
    const monthlySpend = modal.querySelector('#cursor-monthly-spend')?.value || ''
    const activeUsers = modal.querySelector('#cursor-active-users')?.value || ''
    return {
      monthly_spend: monthlySpend ? parseFloat(monthlySpend) : null,
      active_users: activeUsers ? parseInt(activeUsers) : null
    }
  }
  
  githubBtn.addEventListener('click', async () => {
    try {
      // Simulate GitHub OAuth flow
      const formData = getFormData()
      const result = await simulateOAuthFlow('github', 'cursor', formData)
      resolveCallback(result)
      modal.remove()
    } catch (error) {
      console.error('GitHub OAuth failed:', error)
      alert('GitHub authentication failed. Please try again.')
    }
  })
  
  googleBtn.addEventListener('click', async () => {
    try {
      // Simulate Google OAuth flow
      const formData = getFormData()
      const result = await simulateOAuthFlow('google', 'cursor', formData)
      resolveCallback(result)
      modal.remove()
    } catch (error) {
      console.error('Google OAuth failed:', error)
      alert('Google authentication failed. Please try again.')
    }
  })
  
  emailBtn.addEventListener('click', async () => {
    try {
      // Simulate email authentication flow
      const formData = getFormData()
      const result = await simulateEmailAuth('cursor', formData)
      resolveCallback(result)
      modal.remove()
    } catch (error) {
      console.error('Email authentication failed:', error)
      alert('Email authentication failed. Please try again.')
    }
  })
}

function setupWindsurfLoginHandlers(modal, resolveCallback) {
  const githubBtn = modal.querySelector('#github-windsurf-btn')
  const googleBtn = modal.querySelector('#google-windsurf-btn')
  const emailBtn = modal.querySelector('#email-windsurf-btn')
  
  const getFormData = () => {
    const monthlySpend = modal.querySelector('#windsurf-monthly-spend')?.value || ''
    const activeUsers = modal.querySelector('#windsurf-active-users')?.value || ''
    return {
      monthly_spend: monthlySpend ? parseFloat(monthlySpend) : null,
      active_users: activeUsers ? parseInt(activeUsers) : null
    }
  }
  
  githubBtn.addEventListener('click', async () => {
    try {
      // Simulate GitHub OAuth flow for Windsurf/Codeium
      const formData = getFormData()
      const result = await simulateOAuthFlow('github', 'windsurf', formData)
      resolveCallback(result)
      modal.remove()
    } catch (error) {
      console.error('GitHub OAuth failed:', error)
      alert('GitHub authentication failed. Please try again.')
    }
  })
  
  googleBtn.addEventListener('click', async () => {
    try {
      // Simulate Google OAuth flow for Windsurf/Codeium
      const formData = getFormData()
      const result = await simulateOAuthFlow('google', 'windsurf', formData)
      resolveCallback(result)
      modal.remove()
    } catch (error) {
      console.error('Google OAuth failed:', error)
      alert('GitHub authentication failed. Please try again.')
    }
  })
  
  emailBtn.addEventListener('click', async () => {
    try {
      // Simulate email authentication flow for Windsurf/Codeium
      const formData = getFormData()
      const result = await simulateEmailAuth('windsurf', formData)
      resolveCallback(result)
      modal.remove()
    } catch (error) {
      console.error('Email authentication failed:', error)
      alert('Email authentication failed. Please try again.')
    }
  })
}

function setupVSCodeLoginHandlers(modal, resolveCallback) {
  const microsoftBtn = modal.querySelector('#microsoft-vscode-btn')
  const githubBtn = modal.querySelector('#github-vscode-btn')
  
  const getFormData = () => {
    const monthlySpend = modal.querySelector('#vscode-monthly-spend')?.value || ''
    const activeUsers = modal.querySelector('#vscode-active-users')?.value || ''
    return {
      monthly_spend: monthlySpend ? parseFloat(monthlySpend) : null,
      active_users: activeUsers ? parseInt(activeUsers) : null
    }
  }
  
  microsoftBtn.addEventListener('click', async () => {
    try {
      // Simulate Microsoft OAuth flow for VS Code
      const formData = getFormData()
      const result = await simulateOAuthFlow('microsoft', 'vscode', formData)
      resolveCallback(result)
      modal.remove()
    } catch (error) {
      console.error('Microsoft OAuth failed:', error)
      alert('Microsoft authentication failed. Please try again.')
    }
  })
  
  githubBtn.addEventListener('click', async () => {
    try {
      // Simulate GitHub OAuth flow for VS Code
      const formData = getFormData()
      const result = await simulateOAuthFlow('github', 'vscode', formData)
      resolveCallback(result)
      modal.remove()
    } catch (error) {
      console.error('GitHub OAuth failed:', error)
      alert('GitHub authentication failed. Please try again.')
    }
  })
}

function setupJetBrainsLoginHandlers(modal, resolveCallback) {
  const jetbrainsBtn = modal.querySelector('#jetbrains-sso-btn')
  const githubBtn = modal.querySelector('#github-jetbrains-btn')
  
  const getFormData = () => {
    const monthlySpend = modal.querySelector('#jetbrains-monthly-spend')?.value || ''
    const activeUsers = modal.querySelector('#jetbrains-active-users')?.value || ''
    return {
      monthly_spend: monthlySpend ? parseFloat(monthlySpend) : null,
      active_users: activeUsers ? parseInt(activeUsers) : null
    }
  }
  
  jetbrainsBtn.addEventListener('click', async () => {
    try {
      // Simulate JetBrains SSO flow
      const formData = getFormData()
      const result = await simulateJetBrainsSSO(formData)
      resolveCallback(result)
      modal.remove()
    } catch (error) {
      console.error('JetBrains SSO failed:', error)
      alert('JetBrains authentication failed. Please try again.')
    }
  })
  
  githubBtn.addEventListener('click', async () => {
    try {
      // Simulate GitHub OAuth flow for JetBrains
      const formData = getFormData()
      const result = await simulateOAuthFlow('github', 'jetbrains', formData)
      resolveCallback(result)
      modal.remove()
    } catch (error) {
      console.error('GitHub OAuth failed:', error)
      alert('GitHub authentication failed. Please try again.')
    }
  })
}

function setupClaudeLoginHandlers(modal, resolveCallback) {
  const anthropicBtn = modal.querySelector('#anthropic-claude-btn')
  const githubBtn = modal.querySelector('#github-claude-btn')
  
  const getFormData = () => {
    const monthlySpend = modal.querySelector('#claude-monthly-spend')?.value || ''
    const activeUsers = modal.querySelector('#claude-active-users')?.value || ''
    return {
      monthly_spend: monthlySpend ? parseFloat(monthlySpend) : null,
      active_users: activeUsers ? parseInt(activeUsers) : null
    }
  }
  
  anthropicBtn.addEventListener('click', async () => {
    try {
      // Simulate Anthropic OAuth flow for Claude Code
      const formData = getFormData()
      const result = await simulateClaudeSSO(formData)
      resolveCallback(result)
      modal.remove()
    } catch (error) {
      console.error('Anthropic OAuth failed:', error)
      alert('Anthropic authentication failed. Please try again.')
    }
  })
  
  githubBtn.addEventListener('click', async () => {
    try {
      // Simulate GitHub OAuth flow for Claude Code
      const formData = getFormData()
      const result = await simulateOAuthFlow('github', 'claude', formData)
      resolveCallback(result)
      modal.remove()
    } catch (error) {
      console.error('GitHub OAuth failed:', error)
      alert('GitHub authentication failed. Please try again.')
    }
  })
}

function setupCopilotLoginHandlers(modal, resolveCallback) {
  const microsoftBtn = modal.querySelector('#microsoft-copilot-btn')
  const githubBtn = modal.querySelector('#github-copilot-btn')
  
  const getFormData = () => {
    const monthlySpend = modal.querySelector('#copilot-monthly-spend')?.value || ''
    const activeUsers = modal.querySelector('#copilot-active-users')?.value || ''
    return {
      monthly_spend: monthlySpend ? parseFloat(monthlySpend) : null,
      active_users: activeUsers ? parseInt(activeUsers) : null
    }
  }
  
  microsoftBtn.addEventListener('click', async () => {
    try {
      // Simulate Microsoft OAuth flow for GitHub Copilot
      const formData = getFormData()
      const result = await simulateOAuthFlow('microsoft', 'copilot', formData)
      resolveCallback(result)
      modal.remove()
    } catch (error) {
      console.error('Microsoft OAuth failed:', error)
      alert('Microsoft authentication failed. Please try again.')
    }
  })
  
  githubBtn.addEventListener('click', async () => {
    try {
      // Simulate GitHub OAuth flow for GitHub Copilot
      const formData = getFormData()
      const result = await simulateOAuthFlow('github', 'copilot', formData)
      resolveCallback(result)
      modal.remove()
    } catch (error) {
      console.error('GitHub OAuth failed:', error)
      alert('GitHub authentication failed. Please try again.')
    }
  })
}

// OAuth Simulation Functions
async function simulateOAuthFlow(provider, ide, formData = {}) {
  // Simulate OAuth flow delay
  await new Promise(resolve => setTimeout(resolve, 2000))
  
  // Simulate successful authentication
  return {
    success: true,
    provider,
    ide,
    message: `Successfully authenticated with ${provider} for ${ide}`,
    formData
  }
}

async function simulateEmailAuth(ide, formData = {}) {
  // Simulate email authentication delay
  await new Promise(resolve => setTimeout(resolve, 1500))
  
  // Simulate successful authentication
  return {
    success: true,
    provider: 'email',
    ide,
    message: `Successfully authenticated with email for ${ide}`,
    formData
  }
}

async function simulateJetBrainsSSO(formData = {}) {
  // Simulate JetBrains SSO delay
  await new Promise(resolve => setTimeout(resolve, 2500))
  
  // Simulate successful authentication
  return {
    success: true,
    provider: 'jetbrains',
    ide: 'jetbrains',
    message: 'Successfully authenticated with JetBrains Account',
    formData
  }
}

async function simulateClaudeSSO(formData = {}) {
  // Simulate Claude Code SSO delay
  await new Promise(resolve => setTimeout(resolve, 2000))
  
  // Simulate successful authentication
  return {
    success: true,
    provider: 'anthropic',
    ide: 'claude',
    message: 'Successfully authenticated with Anthropic for Claude Code',
    formData
  }
}

async function simulateCopilotSSO(formData = {}) {
  // Simulate GitHub Copilot authentication delay
  await new Promise(resolve => setTimeout(resolve, 1000))
  
  // Simulate successful authentication
  return {
    success: true,
    provider: 'microsoft',
    ide: 'copilot',
    message: 'Successfully authenticated with Microsoft for GitHub Copilot',
    formData
  }
}

// Lifecycle
onMounted(() => {
  loadIDEStatus()
})

// Watch for route changes to refresh IDE status
watch(
  () => route.fullPath,
  (newPath) => {
    // Adjust this path if your ConnectIDEs route is different
    if (newPath === '/connect') {
      loadIDEStatus()
    }
  },
  { immediate: false }
)

// Invite and Connect Code Methods
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
    
    if (import.meta.env.DEV) console.log('Invite API response:', response.data)
    
    if (response.data.invite) {
      invite.value = response.data.invite
      if (import.meta.env.DEV) console.log('Invite created successfully:', response.data.invite)
      showSuccessMessage('Invite link generated successfully!')
    } else {
      console.error('Invite API returned no invite data:', response.data)
      showErrorMessage('Failed to generate invite link — server did not return invite data')
    }
  } catch (error) {
    console.error('Failed to generate invite:', error)
    showErrorMessage('Failed to generate invite link')
  } finally {
    generatingInvite.value = false
  }
}

const generateConnectCode = async () => {
  generatingCode.value = true
  
  try {
    const response = await api.post('/api/ide/connect/code')
    connectCode.value = response.data
    showSuccessMessage('Connect code generated successfully!')
  } catch (error) {
    console.error('Failed to generate connect code:', error)
    showSuccessMessage('Failed to generate connect code: ' + (error.response?.data?.error || error.message))
  } finally {
    generatingCode.value = false
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
    } else {
      showSuccessMessage('Invite link copied to clipboard')
    }
  } catch (error) {
    console.error('Failed to copy invite link:', error)
    showSuccessMessage('Failed to copy invite link')
  }
}

const copyConnectCode = async () => {
  try {
    const code = connectCode.value?.code || ''
    if (!code) {
      showSuccessMessage('No connect code available')
      return
    }
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(code)
    } else {
      const textarea = document.createElement('textarea')
      textarea.value = code
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      textarea.remove()
    }
    showSuccessMessage('Connect code copied to clipboard!')
  } catch (error) {
    console.error('Failed to copy connect code:', error)
    showSuccessMessage('Failed to copy connect code')
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
    
    // Show success message
    showSuccessMessage(`Invite sent successfully to ${sentEmail}!`)
  } catch (error) {
    console.error('Failed to send invite:', error)
    
    if (error.response && error.response.status === 422) {
      settingsInviteFormErrors.value.email = 'Invite already sent. You can resend it from team management page.'
    } else {
      showSuccessMessage('Failed to send invite. Please try again.')
    }
  } finally {
    isSendingInvite.value = false
  }
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

</script>

<style scoped>
/* Onboarding Card Structure */
.onboarding-card {
  background: rgba(255, 255, 255, 0.95);
  backdrop-filter: blur(20px);
  border-radius: 24px;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.2);
  overflow: hidden;
  margin: 2rem 0;
}

/* Onboarding Header Styling */
.onboarding-header {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  padding: 3rem 2.5rem;
  position: relative;
}

.dashboard-logo {
  height: 6rem;
  width: auto;
  filter: drop-shadow(0 4px 8px rgba(0, 0, 0, 0.2));
}

.onboarding-title {
  font-size: 2.4rem;
  font-weight: 700;
  letter-spacing: -0.03em;
  margin-bottom: 0.25rem;
  color: white;
}

.onboarding-subtitle {
  font-size: 1.05rem;
  font-weight: 400;
  color: rgba(255, 255, 255, 0.9);
  margin: 0;
  line-height: 1.6;
}

/* Progress Indicator */
.progress-indicator {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 1rem;
}

.progress-step {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
}

.step-number {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.2);
  border: 2px solid rgba(255, 255, 255, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  font-size: 0.9rem;
  transition: all 0.3s ease;
}

.progress-step.completed .step-number {
  background: #28a745;
  border-color: #28a745;
  color: white;
}

.progress-step.active .step-number {
  background: white;
  color: #667eea;
  border-color: white;
  transform: scale(1.1);
}

.step-label {
  font-size: 0.8rem;
  opacity: 0.8;
  font-weight: 500;
  color: white;
}

.progress-connector {
  width: 60px;
  height: 2px;
  background: rgba(255, 255, 255, 0.2);
}

/* Onboarding Body */
.onboarding-body {
  padding: 2rem;
}

.onboarding-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='0.05'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E");
}

/* Onboarding Header Styling - EXACT COPY FROM METRICS PAGE */
.onboarding-header {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  padding: 3rem 2.5rem;
  position: relative;
}

.header-content {
  max-width: 100%;
  margin: 0 auto;
}

.onboarding-header::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='0.1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E");
}

.dashboard-logo {
  height: 6rem !important;
  width: auto;
  filter: drop-shadow(0 4px 8px rgba(0, 0, 0, 0.2));
  max-width: 100%;
  object-fit: contain;
}

.onboarding-title {
  font-size: 2.4rem;
  font-weight: 700;
  letter-spacing: -0.03em;
  margin-bottom: 0.25rem;
  color: white;
}

.onboarding-subtitle {
  font-size: 1.05rem;
  font-weight: 400;
  color: rgba(255, 255, 255, 0.9);
  margin: 0;
  line-height: 1.6;
}

/* Progress Indicator */
.progress-indicator {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 1rem;
}

.progress-step {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
}

.step-number {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.2);
  border: 2px solid rgba(255, 255, 255, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  font-size: 0.9rem;
  transition: all 0.3s ease;
}

.progress-step.completed .step-number {
  background: #28a745;
  border-color: #28a745;
  color: white;
}

.progress-step.active .step-number {
  background: white;
  color: #667eea;
  border-color: white;
  transform: scale(1.1);
}

.step-label {
  font-size: 0.8rem;
  opacity: 0.8;
  font-weight: 500;
  color: white;
}

.progress-connector {
  width: 60px;
  height: 2px;
  background: rgba(255, 255, 255, 0.2);
}

/* Onboarding Body */
.onboarding-body {
  padding: 2rem;
}


/* Enhanced IDE Cards to match Metrics page */
.cicd-section {
  border: 2px solid #e9ecef;
  border-radius: 12px;
  transition: all 0.3s ease;
  background: white;
}

.cicd-section:hover {
  border-color: #667eea;
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.15);
  transform: translateY(-2px);
}

/* Stage icon enhancements */
.stage-icon-wrapper {
  width: 48px;
  height: 48px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.2rem;
  transition: all 0.3s ease;
}

.cicd-section:hover .stage-icon-wrapper {
  transform: scale(1.1);
}

/* Button enhancements */
.btn-success, .btn-primary {
  border-radius: 8px;
  font-weight: 500;
  transition: all 0.3s ease;
}

.btn-success:hover, .btn-primary:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}


/* Consistent Button Styling */
.btn-primary {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border: none;
  font-weight: 600;
  transition: all 0.3s ease;
}

.btn-primary:hover {
  background: linear-gradient(135deg, #5a6fd8 0%, #6a4190 100%);
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);
}

.btn-success {
  background: linear-gradient(135deg, #28a745 0%, #20c997 100%);
  border: none;
  font-weight: 600;
}

.btn-success:hover {
  background: linear-gradient(135deg, #218838 0%, #1ea085 100%);
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(40, 167, 69, 0.3);
}


/* Mobile Responsiveness - Matching Metrics Page */
@media (max-width: 768px) {
  .onboarding-header {
    padding: 2rem 1.5rem;
  }
  
  .dashboard-logo {
    height: 4rem;
  }
  
  .onboarding-title {
    font-size: 1.8rem;
  }
  
  .progress-indicator {
    gap: 0.5rem;
  }
  
  .step-number {
    width: 32px;
    height: 32px;
    font-size: 0.8rem;
  }
  
  .step-label {
    font-size: 0.7rem;
  }
  
  .progress-connector {
    width: 40px;
  }
  
  .onboarding-body {
    padding: 1rem;
  }
  
  .cicd-section {
    margin-bottom: 1rem;
  }
}


/* Loading States and Micro-interactions */
.spinner-border {
  border-width: 0.25em;
}

.fade-enter-active, .fade-leave-active {
  transition: opacity 0.3s ease;
}

.fade-enter-from, .fade-leave-to {
  opacity: 0;
}

/* Pulse animation for active states */
@keyframes pulse {
  0% {
    box-shadow: 0 0 0 0 rgba(102, 126, 234, 0.7);
  }
  70% {
    box-shadow: 0 0 0 10px rgba(102, 126, 234, 0);
  }
  100% {
    box-shadow: 0 0 0 0 rgba(102, 126, 234, 0);
  }
}

.pulse {
  animation: pulse 2s infinite;
}


/* Accessibility Improvements */
.btn:focus, .cicd-section:focus {
  outline: 2px solid #667eea;
  outline-offset: 2px;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

/* High contrast mode support */
@media (prefers-contrast: high) {
  .onboarding-card {
    border: 2px solid #000;
  }
  
  .cicd-section {
    border: 2px solid #000;
  }
}

/* Ensure buttons are clickable */
.btn {
  position: relative;
  z-index: 10;
}
</style>


