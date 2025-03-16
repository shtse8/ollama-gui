// A simple toast notification service
export function useToast() {
  const error = (message: string) => {
    console.error(`[TOAST ERROR]: ${message}`)
  }

  const success = (message: string) => {
    console.log(`[TOAST SUCCESS]: ${message}`)
  }

  const info = (message: string) => {
    console.log(`[TOAST INFO]: ${message}`)
  }

  const warning = (message: string) => {
    console.warn(`[TOAST WARNING]: ${message}`)
  }

  return {
    error,
    success,
    info,
    warning
  }
} 