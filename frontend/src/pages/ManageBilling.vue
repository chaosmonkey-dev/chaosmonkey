<template>
  <div class="manage-billing-page">
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
          
          <!-- Current Plan Card -->
          <div class="card border-0 shadow-sm mb-4">
            <div class="card-body p-4">
              <div class="row align-items-center">
                <div class="col-md-8">
                  <div class="d-flex align-items-center mb-3">
                    <div class="plan-icon me-3">
                      <div class="icon-wrapper bg-primary bg-opacity-10 rounded p-3">
                        <i class="bi bi-crown-fill text-primary fs-4"></i>
                      </div>
                    </div>
                    <div>
                      <h2 class="h4 mb-1">{{ currentPlan.name }} Plan</h2>
                      <p class="text-muted mb-0">{{ currentPlan.description }}</p>
                    </div>
                  </div>
                  <div class="plan-details">
                    <div class="row g-3">
                      <div class="col-md-4">
                        <div class="detail-item">
                          <span class="detail-label small text-muted">Monthly Cost</span>
                          <span class="detail-value fw-semibold">${{ currentPlan.price }}/month</span>
                        </div>
                      </div>
                      <div class="col-md-4">
                        <div class="detail-item">
                          <span class="detail-label small text-muted">Team Members</span>
                          <span class="detail-value fw-semibold">{{ usedSeats }}/{{ currentPlan.maxUsers }}</span>
                        </div>
                      </div>
                      <div class="col-md-4">
                        <div class="detail-item">
                          <span class="detail-label small text-muted">Billing Cycle</span>
                          <span class="detail-value fw-semibold">Monthly</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                <div class="col-md-4 text-md-end">
                  <div class="plan-status mb-3">
                    <span :class="getStatusClass(currentPlan.status)" class="badge">
                      {{ currentPlan.status }}
                    </span>
                  </div>
                  <div class="next-billing mb-3">
                    <small class="text-muted">Next billing date</small>
                    <div class="fw-semibold">{{ nextBillingDate }}</div>
                  </div>
                  <button @click="showUpgradeModal = true" class="btn btn-outline-primary w-100">
                    <i class="bi bi-arrow-up-circle me-2"></i>Upgrade Plan
                  </button>
                </div>
              </div>
            </div>
          </div>

          <!-- Usage Overview -->
          <div class="card border-0 shadow-sm mb-4">
            <div class="card-body p-4">
              <div class="d-flex justify-content-between align-items-center mb-4">
                <h3 class="h5 mb-0">Usage Overview</h3>
                <button @click="loadBillingData" class="btn btn-sm btn-outline-secondary" :disabled="usageLoading">
                  <span v-if="usageLoading" class="spinner-border spinner-border-sm me-1"></span>
                  <i class="bi bi-arrow-clockwise me-1"></i>Refresh
                </button>
              </div>
              
              <div v-if="usageLoading" class="text-center py-4">
                <div class="spinner-border text-primary" role="status">
                  <span class="visually-hidden">Loading usage data...</span>
                </div>
                <p class="text-muted mt-2">Loading usage data...</p>
              </div>
              
              <div v-else class="row g-4">
                <div class="col-md-6">
                  <div class="usage-card">
                    <div class="d-flex justify-content-between align-items-center mb-2">
                      <span class="usage-label">Team Members</span>
                      <span class="usage-value">{{ usedSeats }}/{{ currentPlan.maxUsers }}</span>
                    </div>
                    <div class="progress mb-2" style="height: 8px;">
                      <div 
                        class="progress-bar" 
                        :class="getProgressBarClass(usagePercentage)"
                        :style="{ width: `${usagePercentage}%` }"
                      ></div>
                    </div>
                    <small class="text-muted">{{ currentPlan.maxUsers - usedSeats }} seats available</small>
                  </div>
                </div>
                <div class="col-md-6">
                  <div class="usage-card">
                    <div class="d-flex justify-content-between align-items-center mb-2">
                      <span class="usage-label">API Calls</span>
                      <span class="usage-value">{{ apiCallsUsed.toLocaleString() }}/1M</span>
                    </div>
                    <div class="progress mb-2" style="height: 8px;">
                      <div 
                        class="progress-bar bg-info" 
                        :style="{ width: `${apiUsagePercentage}%` }"
                      ></div>
                    </div>
                    <small class="text-muted">{{ (1000000 - apiCallsUsed).toLocaleString() }} calls remaining</small>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Billing History -->
          <div class="card border-0 shadow-sm mb-4">
            <div class="card-body p-4">
              <div class="d-flex justify-content-between align-items-center mb-4">
                <h3 class="h5 mb-0">Billing History</h3>
                <div class="d-flex gap-2">
                  <button @click="loadBillingData" class="btn btn-sm btn-outline-secondary" :disabled="billingHistoryLoading">
                    <span v-if="billingHistoryLoading" class="spinner-border spinner-border-sm me-1"></span>
                    <i class="bi bi-arrow-clockwise me-1"></i>Refresh
                  </button>
                  <button class="btn btn-sm btn-outline-secondary">
                    <i class="bi bi-download me-1"></i>Download All
                  </button>
                </div>
              </div>
              
              <div v-if="billingHistoryLoading" class="text-center py-4">
                <div class="spinner-border text-primary" role="status">
                  <span class="visually-hidden">Loading billing history...</span>
                </div>
                <p class="text-muted mt-2">Loading billing history...</p>
              </div>
              
              <div v-else class="billing-history">
                <div v-for="invoice in billingHistory" :key="invoice.id" class="invoice-row">
                  <div class="d-flex align-items-center">
                    <div class="invoice-date me-3">
                      <div class="date-label small text-muted">{{ formatDate(invoice.date) }}</div>
                    </div>
                    <div class="invoice-info flex-grow-1">
                      <div class="invoice-description fw-semibold">{{ invoice.description }}</div>
                      <div class="invoice-id small text-muted">Invoice #{{ invoice.id }}</div>
                    </div>
                    <div class="invoice-amount me-3">
                      <span class="amount fw-semibold">${{ invoice.amount }}</span>
                    </div>
                    <div class="invoice-status me-3">
                      <span :class="getInvoiceStatusClass(invoice.status)" class="badge">
                        {{ invoice.status }}
                      </span>
                    </div>
                    <div class="invoice-actions">
                      <button 
                        @click="downloadInvoice(invoice.id)" 
                        class="btn btn-sm btn-outline-secondary"
                        :disabled="loadingStates[getLoadingKey(`invoice_${invoice.id}`)]"
                      >
                        <span v-if="loadingStates[getLoadingKey(`invoice_${invoice.id}`)]" class="spinner-border spinner-border-sm"></span>
                        <i v-else class="bi bi-download"></i>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Payment Method -->
          <div class="card border-0 shadow-sm">
            <div class="card-body p-4">
              <div class="d-flex justify-content-between align-items-center mb-4">
                <h3 class="h5 mb-0">Payment Method</h3>
                <button @click="showPaymentModal = true" class="btn btn-sm btn-outline-primary">
                  <i class="bi bi-pencil me-1"></i>Edit
                </button>
              </div>
              
              <div class="payment-method">
                <div class="d-flex align-items-center">
                  <div class="card-icon me-3">
                    <i class="bi bi-credit-card-2-back fs-3 text-muted"></i>
                  </div>
                  <div class="card-info">
                    <div class="card-brand fw-semibold">{{ paymentMethod.brand }}</div>
                    <div class="card-number">•••• •••• •••• {{ paymentMethod.last4 }}</div>
                    <div class="card-expiry small text-muted">Expires {{ paymentMethod.expiry }}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Upgrade Modal -->
    <div v-if="showUpgradeModal" class="modal fade show d-block" tabindex="-1">
      <div class="modal-dialog modal-dialog-centered modal-lg">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">Upgrade Your Plan</h5>
            <button type="button" class="btn-close" @click="showUpgradeModal = false"></button>
          </div>
          <div class="modal-body">
            <div class="row g-4">
              <div v-for="plan in availablePlans" :key="plan.id" class="col-md-4">
                <div 
                  class="plan-card card h-100" 
                  :class="{ 'border-primary': plan.id === currentPlan.id, 'border-2': plan.recommended }"
                >
                  <div v-if="plan.recommended" class="recommended-badge">
                    <span class="badge bg-warning">Recommended</span>
                  </div>
                  <div class="card-body text-center">
                    <h4 class="card-title">{{ plan.name }}</h4>
                    <div class="price mb-3">
                      <span class="price-amount">${{ plan.price }}</span>
                      <span class="price-period">/month</span>
                    </div>
                    <ul class="features list-unstyled">
                      <li v-for="feature in plan.features" :key="feature" class="mb-2">
                        <i class="bi bi-check-circle-fill text-success me-2"></i>
                        {{ feature }}
                      </li>
                    </ul>
                    <button 
                      class="btn w-100"
                      :class="plan.id === currentPlan.id ? 'btn-secondary' : 'btn-primary'"
                      @click="selectPlan(plan)"
                      :disabled="plan.id === currentPlan.id || loadingStates[getLoadingKey('upgrade')]"
                    >
                      <span v-if="loadingStates[getLoadingKey('upgrade')] && plan.id !== currentPlan.id" class="spinner-border spinner-border-sm me-2"></span>
                      {{ plan.id === currentPlan.id ? 'Current Plan' : 'Upgrade' }}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" @click="showUpgradeModal = false">Cancel</button>
          </div>
        </div>
      </div>
      <div class="modal-backdrop fade show" @click="showUpgradeModal = false"></div>
    </div>

    <!-- Payment Method Modal -->
    <div v-if="showPaymentModal" class="modal fade show d-block" tabindex="-1">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">Update Payment Method</h5>
            <button type="button" class="btn-close" @click="showPaymentModal = false"></button>
          </div>
          <div class="modal-body">
            <form @submit.prevent="updatePaymentMethod">
              <div class="mb-3">
                <label for="cardNumber" class="form-label">Card Number</label>
                <input 
                  v-model="paymentForm.cardNumber" 
                  type="text" 
                  class="form-control" 
                  id="cardNumber"
                  :class="{ 'is-invalid': paymentFormErrors.cardNumber }"
                  placeholder="1234 5678 9012 3456"
                  maxlength="19"
                  @input="formatCardNumber"
                  required
                >
                <div v-if="paymentFormErrors.cardNumber" class="invalid-feedback">
                  {{ paymentFormErrors.cardNumber }}
                </div>
              </div>
              <div class="row">
                <div class="col-md-6 mb-3">
                  <label for="expiry" class="form-label">Expiry Date</label>
                  <input 
                    v-model="paymentForm.expiry" 
                    type="text" 
                    class="form-control" 
                    id="expiry"
                    :class="{ 'is-invalid': paymentFormErrors.expiry }"
                    placeholder="MM/YY"
                    maxlength="5"
                    @input="formatExpiry"
                    required
                  >
                  <div v-if="paymentFormErrors.expiry" class="invalid-feedback">
                    {{ paymentFormErrors.expiry }}
                  </div>
                </div>
                <div class="col-md-6 mb-3">
                  <label for="cvv" class="form-label">CVV</label>
                  <input 
                    v-model="paymentForm.cvv" 
                    type="text" 
                    class="form-control" 
                    id="cvv"
                    :class="{ 'is-invalid': paymentFormErrors.cvv }"
                    placeholder="123"
                    maxlength="4"
                    required
                  >
                  <div v-if="paymentFormErrors.cvv" class="invalid-feedback">
                    {{ paymentFormErrors.cvv }}
                  </div>
                </div>
              </div>
              <div class="mb-3">
                <label for="name" class="form-label">Cardholder Name</label>
                <input 
                  v-model="paymentForm.name" 
                  type="text" 
                  class="form-control" 
                  id="name"
                  :class="{ 'is-invalid': paymentFormErrors.name }"
                  placeholder="John Doe"
                  required
                >
                <div v-if="paymentFormErrors.name" class="invalid-feedback">
                  {{ paymentFormErrors.name }}
                </div>
              </div>
            </form>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" @click="showPaymentModal = false">Cancel</button>
            <button 
              type="button" 
              class="btn btn-primary" 
              @click="updatePaymentMethod"
              :disabled="loadingStates[getLoadingKey('payment')]"
            >
              <span v-if="loadingStates[getLoadingKey('payment')]" class="spinner-border spinner-border-sm me-2"></span>
              Update Payment Method
            </button>
          </div>
        </div>
      </div>
      <div class="modal-backdrop fade show" @click="showPaymentModal = false"></div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import NavUserAvatar from '../components/NavUserAvatar.vue'

const router = useRouter()
const authStore = useAuthStore()

// State
const showUpgradeModal = ref(false)
const showPaymentModal = ref(false)
const isLoading = ref(false)
const loadingStates = ref({})
const billingHistoryLoading = ref(false)
const usageLoading = ref(false)

// Form validation errors
const paymentFormErrors = ref({})

// Current plan data
const currentPlan = ref({
  id: 'pro',
  name: 'Pro',
  description: 'For growing teams and organizations',
  price: 99,
  maxUsers: 20,
  status: 'Active'
})

const usedSeats = ref(8)
const apiCallsUsed = ref(450000)

// Payment method
const paymentMethod = ref({
  brand: 'Visa',
  last4: '4242',
  expiry: '12/25'
})

// Payment form
const paymentForm = ref({
  cardNumber: '',
  expiry: '',
  cvv: '',
  name: ''
})

// Simulated API calls
const simulateApiCall = (endpoint, data = null, delay = 1000) => {
  return new Promise((resolve) => {
    setTimeout(() => {
      console.log(`API Call to ${endpoint}:`, data)
      resolve({ success: true, data })
    }, delay)
  })
}

// Loading states for different actions
const getLoadingKey = (action) => `${action}_global`

// Available plans
const availablePlans = ref([
  {
    id: 'free',
    name: 'Free',
    price: 0,
    features: ['Up to 5 users', 'Basic analytics', 'Community support'],
    recommended: false
  },
  {
    id: 'pro',
    name: 'Pro',
    price: 99,
    features: ['Up to 20 users', 'Advanced analytics', 'Priority support', 'Custom integrations'],
    recommended: true
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    price: 299,
    features: ['Unlimited users', 'Custom analytics', 'Dedicated support', 'SLA guarantee'],
    recommended: false
  }
])

// Billing history
const billingHistory = ref([
  {
    id: 'INV-2024-001',
    date: '2024-03-01',
    description: 'Pro Plan - Monthly',
    amount: '99.00',
    status: 'Paid'
  },
  {
    id: 'INV-2024-002',
    date: '2024-02-01',
    description: 'Pro Plan - Monthly',
    amount: '99.00',
    status: 'Paid'
  },
  {
    id: 'INV-2024-003',
    date: '2024-01-01',
    description: 'Pro Plan - Monthly',
    amount: '99.00',
    status: 'Paid'
  }
])

// Computed
const usagePercentage = computed(() => {
  return Math.round((usedSeats.value / currentPlan.value.maxUsers) * 100)
})

const apiUsagePercentage = computed(() => {
  return Math.round((apiCallsUsed.value / 1000000) * 100)
})

const nextBillingDate = computed(() => {
  const date = new Date()
  date.setMonth(date.getMonth() + 1)
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
})

// Methods
const getStatusClass = (status) => {
  if (status === 'Active') return 'bg-success'
  if (status === 'Trial') return 'bg-warning'
  if (status === 'Expired') return 'bg-danger'
  return 'bg-secondary'
}

const getProgressBarClass = (percentage) => {
  if (percentage > 80) return 'bg-danger'
  if (percentage > 60) return 'bg-warning'
  return 'bg-success'
}

const getInvoiceStatusClass = (status) => {
  if (status === 'Paid') return 'bg-success'
  if (status === 'Pending') return 'bg-warning'
  if (status === 'Failed') return 'bg-danger'
  return 'bg-secondary'
}

// Form validation
const validatePaymentForm = () => {
  const errors = {}
  
  if (!paymentForm.value.cardNumber) {
    errors.cardNumber = 'Card number is required'
  } else if (!/^\d{4}\s?\d{4}\s?\d{4}\s?\d{4}$/.test(paymentForm.value.cardNumber.replace(/\s/g, ''))) {
    errors.cardNumber = 'Please enter a valid card number'
  }
  
  if (!paymentForm.value.expiry) {
    errors.expiry = 'Expiry date is required'
  } else if (!/^(0[1-9]|1[0-2])\/\d{2}$/.test(paymentForm.value.expiry)) {
    errors.expiry = 'Please enter a valid expiry date (MM/YY)'
  }
  
  if (!paymentForm.value.cvv) {
    errors.cvv = 'CVV is required'
  } else if (!/^\d{3,4}$/.test(paymentForm.value.cvv)) {
    errors.cvv = 'Please enter a valid CVV'
  }
  
  if (!paymentForm.value.name) {
    errors.name = 'Cardholder name is required'
  } else if (paymentForm.value.name.length < 3) {
    errors.name = 'Name must be at least 3 characters'
  }
  
  paymentFormErrors.value = errors
  return Object.keys(errors).length === 0
}

const formatDate = (dateString) => {
  const date = new Date(dateString)
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
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

const selectPlan = async (plan) => {
  if (plan.id === currentPlan.value.id) return
  
  if (!confirm(`Upgrade to ${plan.name} plan for $${plan.price}/month?`)) return
  
  const loadingKey = getLoadingKey('upgrade')
  loadingStates.value[loadingKey] = true
  
  try {
    await simulateApiCall('/api/billing/upgrade', { planId: plan.id })
    
    currentPlan.value = { ...plan, status: 'Active' }
    showUpgradeModal.value = false
    showSuccessMessage(`Successfully upgraded to ${plan.name} plan!`)
  } catch (error) {
    console.error('Failed to upgrade plan:', error)
  } finally {
    loadingStates.value[loadingKey] = false
  }
}

const updatePaymentMethod = async () => {
  if (!validatePaymentForm()) return
  
  const loadingKey = getLoadingKey('payment')
  loadingStates.value[loadingKey] = true
  
  try {
    await simulateApiCall('/api/billing/payment-method', paymentForm.value)
    
    paymentMethod.value = {
      brand: 'Visa',
      last4: paymentForm.value.cardNumber.slice(-4),
      expiry: paymentForm.value.expiry
    }
    
    paymentForm.value = {
      cardNumber: '',
      expiry: '',
      cvv: '',
      name: ''
    }
    paymentFormErrors.value = {}
    showPaymentModal.value = false
    
    showSuccessMessage('Payment method updated successfully!')
  } catch (error) {
    console.error('Failed to update payment method:', error)
  } finally {
    loadingStates.value[loadingKey] = false
  }
}

const downloadInvoice = async (invoiceId) => {
  const loadingKey = getLoadingKey(`invoice_${invoiceId}`)
  loadingStates.value[loadingKey] = true
  
  try {
    await simulateApiCall('/api/billing/download-invoice', { invoiceId })
    showSuccessMessage(`Invoice ${invoiceId} downloaded successfully!`)
  } catch (error) {
    console.error('Failed to download invoice:', error)
  } finally {
    loadingStates.value[loadingKey] = false
  }
}

const loadBillingData = async () => {
  billingHistoryLoading.value = true
  usageLoading.value = true
  
  try {
    await Promise.all([
      simulateApiCall('/api/billing/history'),
      simulateApiCall('/api/billing/usage')
    ])
    // Data is already loaded from refs
  } catch (error) {
    console.error('Failed to load billing data:', error)
  } finally {
    billingHistoryLoading.value = false
    usageLoading.value = false
  }
}

// Form formatting functions
const formatCardNumber = (event) => {
  let value = event.target.value.replace(/\s/g, '')
  let formattedValue = value.match(/.{1,4}/g)?.join(' ') || value
  paymentForm.value.cardNumber = formattedValue
}

const formatExpiry = (event) => {
  let value = event.target.value.replace(/\D/g, '')
  if (value.length >= 2) {
    value = value.slice(0, 2) + '/' + value.slice(2, 4)
  }
  paymentForm.value.expiry = value
}

const handleLogout = async () => {
  await authStore.logout()
  router.push('/login')
}

const goToDashboards = () => {
  router.push('/dashboards')
}

onMounted(async () => {
  await loadBillingData()
})
</script>

<style scoped>
.manage-billing-page {
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

.plan-icon .icon-wrapper {
  border: 2px solid #000;
}

.detail-item {
  display: flex;
  flex-direction: column;
}

.detail-label {
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.detail-value {
  color: #000;
  font-size: 1.1rem;
}

.usage-card {
  background-color: #f8f9fa;
  padding: 1rem;
  border-radius: 0.5rem;
  border: 1px solid #e9ecef;
}

.usage-label {
  font-weight: 500;
  color: #000;
}

.usage-value {
  font-weight: 600;
  color: #000;
}

.progress {
  background-color: #e9ecef;
  border-radius: 0.25rem;
}

.progress-bar {
  border-radius: 0.25rem;
}

.invoice-row {
  padding: 1rem 0;
  border-bottom: 1px solid #e9ecef;
}

.invoice-row:last-child {
  border-bottom: none;
}

.invoice-description {
  color: #000;
}

.invoice-id {
  font-size: 0.85rem;
}

.amount {
  color: #000;
  font-size: 1.1rem;
}

.payment-method {
  background-color: #f8f9fa;
  padding: 1rem;
  border-radius: 0.5rem;
  border: 1px solid #e9ecef;
}

.card-brand {
  color: #000;
  font-size: 1.1rem;
}

.card-number {
  color: #6c757d;
}

.plan-card {
  cursor: pointer;
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}

.plan-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.plan-card.border-primary {
  border-width: 2px !important;
}

.recommended-badge {
  position: absolute;
  top: -10px;
  right: 20px;
}

.price-amount {
  font-size: 2rem;
  font-weight: 700;
  color: #000;
}

.price-period {
  color: #6c757d;
  font-size: 1rem;
}

.features {
  text-align: left;
  font-size: 0.9rem;
}

.badge {
  font-size: 0.75rem;
  padding: 0.375rem 0.75rem;
  border-radius: 0.375rem;
  text-transform: uppercase;
  font-weight: 500;
}

.modal {
  background-color: rgba(0, 0, 0, 0.5);
}

.modal-content {
  border: none;
  border-radius: 0.5rem;
  box-shadow: 0 10px 25px rgba(0, 0, 0, 0.15);
}

.form-control {
  border: 1px solid #dee2e6;
  border-radius: 0.375rem;
  padding: 0.5rem 0.75rem;
}

.form-control:focus {
  border-color: #000;
  box-shadow: 0 0 0 0.2rem rgba(0, 0, 0, 0.25);
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

.btn-outline-secondary {
  border-color: #dee2e6;
  color: #6c757d;
}

.btn-outline-secondary:hover {
  background-color: #6c757d;
  border-color: #6c757d;
  color: #fff;
}

/* Responsive adjustments */
@media (max-width: 768px) {
  .dashboard-title {
    font-size: 1.5rem;
  }
  
  .plan-card {
    margin-bottom: 1rem;
  }
  
  .invoice-row {
    padding: 0.75rem 0;
  }
}
</style>
