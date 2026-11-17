import { fireEvent } from '@testing-library/react'

// user-event does not yet recognize Chromium's plaintext-only editing mode.
if (typeof HTMLElement !== 'undefined') {
  const setAttribute = HTMLElement.prototype.setAttribute
  HTMLElement.prototype.setAttribute = function (name, value) {
    return setAttribute.call(
      this,
      name,
      name === 'contentEditable' || name === 'contenteditable'
        ? value === 'plaintext-only'
          ? 'true'
          : value
        : value
    )
  }
  const change = fireEvent.change
  fireEvent.change = (element, options) => {
    if (
      element instanceof HTMLElement &&
      element.dataset.slot === 'text-editor'
    ) {
      element.textContent = options?.target?.value ?? ''
      return fireEvent.input(element, { inputType: 'insertText' })
    }
    return change(element, options)
  }
}
