// Shared utilities for admin pages

// Simulated API call utility
export const simulateApiCall = (endpoint, data = null, delay = 1000) => {
  return new Promise((resolve) => {
    setTimeout(() => {
      console.log(`API Call to ${endpoint}:`, data)
      resolve({ success: true, data })
    }, delay)
  })
}

// Loading state management
export const getLoadingKey = (action, id = null) => {
  return id ? `${action}_${id}` : `${action}_global`
}

// Success message notification
export const showSuccessMessage = (message) => {
  // Remove any existing notifications
  const existingNotifications = document.querySelectorAll('.alert-success')
  existingNotifications.forEach(notification => notification.remove())
  
  // Create new notification
  const notification = document.createElement('div')
  notification.className = 'alert alert-success position-fixed top-0 end-0 m-3'
  notification.style.zIndex = '9999'
  notification.innerHTML = `
    <i class="bi bi-check-circle me-2"></i>${message}
  `
  document.body.appendChild(notification)
  
  // Auto-remove after 3 seconds
  setTimeout(() => {
    if (notification.parentNode) {
      notification.remove()
    }
  }, 3000)
}

// Error message notification
export const showErrorMessage = (message) => {
  // Remove any existing notifications
  const existingNotifications = document.querySelectorAll('.alert-danger')
  existingNotifications.forEach(notification => notification.remove())
  
  // Create new notification
  const notification = document.createElement('div')
  notification.className = 'alert alert-danger position-fixed top-0 end-0 m-3'
  notification.style.zIndex = '9999'
  notification.innerHTML = `
    <i class="bi bi-exclamation-triangle me-2"></i>${message}
  `
  document.body.appendChild(notification)
  
  // Auto-remove after 5 seconds
  setTimeout(() => {
    if (notification.parentNode) {
      notification.remove()
    }
  }, 5000)
}

// Form validation helpers
export const validateEmail = (email) => {
  return /\S+@\S+\.\S+/.test(email)
}

export const validateRequired = (value, minLength = 1) => {
  return value && value.trim().length >= minLength
}

export const validateMinLength = (value, minLength) => {
  return value && value.length >= minLength
}

export const validatePassword = (password) => {
  return password && 
         password.length >= 8 && 
         /(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(password)
}

// Format helpers
export const formatDate = (dateString) => {
  const date = new Date(dateString)
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

export const formatCurrency = (amount) => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD'
  }).format(amount)
}

export const formatNumber = (number) => {
  return new Intl.NumberFormat('en-US').format(number)
}

// Card formatting
export const formatCardNumber = (value) => {
  const cleaned = value.replace(/\s/g, '')
  const groups = cleaned.match(/.{1,4}/g)
  return groups ? groups.join(' ') : cleaned
}

export const formatExpiry = (value) => {
  const cleaned = value.replace(/\D/g, '')
  if (cleaned.length >= 2) {
    return cleaned.slice(0, 2) + '/' + cleaned.slice(2, 4)
  }
  return cleaned
}

// Status badge helpers
export const getStatusClass = (status) => {
  const statusMap = {
    'active': 'bg-success',
    'inactive': 'bg-secondary', 
    'pending': 'bg-warning',
    'trial': 'bg-warning',
    'expired': 'bg-danger',
    'paid': 'bg-success',
    'failed': 'bg-danger',
    'connected': 'bg-success',
    'disconnected': 'bg-secondary'
  }
  return statusMap[status?.toLowerCase()] || 'bg-secondary'
}

// Progress bar helpers
export const getProgressBarClass = (percentage) => {
  if (percentage > 80) return 'bg-danger'
  if (percentage > 60) return 'bg-warning'
  return 'bg-success'
}

// Common form error handling
export const createFormErrors = () => ref({})

export const clearFormErrors = (errors) => {
  Object.keys(errors.value).forEach(key => {
    errors.value[key] = null
  })
}

export const hasFormErrors = (errors) => {
  return Object.values(errors.value).some(error => error !== null && error !== undefined && error !== '')
}

// Debounce utility for search inputs
export const debounce = (func, wait) => {
  let timeout
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout)
      func(...args)
    }
    clearTimeout(timeout)
    timeout = setTimeout(later, wait)
  }
}

// Pagination helpers
export const paginationUtils = {
  getPages: (totalItems, itemsPerPage) => {
    return Math.ceil(totalItems / itemsPerPage)
  },
  
  getStartIndex: (page, itemsPerPage) => {
    return (page - 1) * itemsPerPage
  },
  
  getEndIndex: (page, itemsPerPage, totalItems) => {
    const start = (page - 1) * itemsPerPage
    return Math.min(start + itemsPerPage, totalItems)
  },
  
  getPageItems: (items, page, itemsPerPage) => {
    const start = (page - 1) * itemsPerPage
    const end = start + itemsPerPage
    return items.slice(start, end)
  }
}

// Sorting helpers
export const sortingUtils = {
  sortBy: (array, key, order = 'asc') => {
    return [...array].sort((a, b) => {
      let aValue = a[key]
      let bValue = b[key]
      
      if (typeof aValue === 'string') {
        aValue = aValue.toLowerCase()
        bValue = bValue.toLowerCase()
      }
      
      if (order === 'asc') {
        return aValue > bValue ? 1 : -1
      } else {
        return aValue < bValue ? 1 : -1
      }
    })
  },
  
  toggleSort: (currentField, currentOrder, newField) => {
    if (currentField === newField) {
      return currentOrder === 'asc' ? 'desc' : 'asc'
    }
    return 'asc'
  }
}

// Filter helpers
export const filterUtils = {
  search: (array, query, fields) => {
    if (!query) return array
    
    const lowerQuery = query.toLowerCase()
    return array.filter(item => 
      fields.some(field => {
        const value = item[field]
        return value && typeof value === 'string' && value.toLowerCase().includes(lowerQuery)
      })
    )
  },
  
  filterByValue: (array, field, value) => {
    if (!value) return array
    return array.filter(item => item[field] === value)
  }
}
