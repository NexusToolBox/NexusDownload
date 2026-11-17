import { cn } from '@renderer/lib/utils'
import {
  type ChangeEvent,
  type ComponentProps,
  type HTMLAttributes,
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
} from 'react'

/** Plain-text editor with the input contract used by existing form controllers. */
function Textarea({
  className,
  value,
  defaultValue,
  onChange,
  ref,
  disabled,
  readOnly,
  rows = 3,
  maxLength,
  name,
  placeholder,
  autoFocus,
  ...props
}: ComponentProps<'textarea'>) {
  const editor = useRef<HTMLDivElement>(null)
  const selection = useCallback(() => {
    const element = editor.current
    const selected = window.getSelection()
    if (
      !element ||
      !selected?.rangeCount ||
      !element.contains(selected.anchorNode)
    )
      return [0, 0]
    const range = selected.getRangeAt(0)
    const start = range.cloneRange()
    start.selectNodeContents(element)
    start.setEnd(range.startContainer, range.startOffset)
    return [
      start.toString().length,
      start.toString().length + range.toString().length,
    ]
  }, [])
  const selectRange = useCallback((start: number, end: number) => {
    const element = editor.current
    if (!element) return
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    const range = document.createRange()
    let node = walker.nextNode(),
      offset = 0,
      found = false
    while (node) {
      const length = node.textContent?.length ?? 0
      if (!found && start <= offset + length) {
        range.setStart(node, Math.max(0, start - offset))
        found = true
      }
      if (found && end <= offset + length) {
        range.setEnd(node, Math.max(0, end - offset))
        const selected = window.getSelection()
        selected?.removeAllRanges()
        selected?.addRange(range)
        return
      }
      offset += length
      node = walker.nextNode()
    }
  }, [])
  useImperativeHandle(ref, () => {
    const element = editor.current as HTMLDivElement &
      Partial<HTMLTextAreaElement>
    Object.defineProperties(element, {
      value: {
        configurable: true,
        get: () =>
          (element.innerText ?? element.textContent ?? '').replace(/\r/g, ''),
        set: (text: string) => {
          element.textContent = text
        },
      },
      name: { configurable: true, get: () => name ?? '' },
      selectionStart: { configurable: true, get: () => selection()[0] },
      selectionEnd: { configurable: true, get: () => selection()[1] },
      setSelectionRange: { configurable: true, value: selectRange },
    })
    return element as unknown as HTMLTextAreaElement
  })
  useLayoutEffect(() => {
    const element = editor.current
    if (!element) return
    const next = String(value ?? defaultValue ?? '')
    if (
      (element.innerText ?? element.textContent ?? '').replace(/\r/g, '') !==
      next
    ) {
      const position = selection()
      element.textContent = next
      if (document.activeElement === element)
        selectRange(position[0], position[1])
    }
  }, [value, defaultValue, selection, selectRange])
  useLayoutEffect(() => {
    if (autoFocus) editor.current?.focus()
  }, [autoFocus])
  return (
    // biome-ignore lint/a11y/useSemanticElements: approved custom plain-text editor intentionally replaces native textarea
    <div
      {...(props as HTMLAttributes<HTMLDivElement>)}
      ref={editor}
      role="textbox"
      aria-multiline="true"
      aria-disabled={disabled || undefined}
      aria-readonly={readOnly || undefined}
      aria-placeholder={placeholder}
      data-placeholder={placeholder}
      data-slot="text-editor"
      tabIndex={disabled ? -1 : 0}
      contentEditable={!disabled && !readOnly ? 'plaintext-only' : false}
      suppressContentEditableWarning
      style={{ minHeight: `${rows * 22 + 16}px`, ...props.style }}
      className={cn('nx-text-editor', className)}
      onInput={(event) => {
        const element = event.currentTarget
        let next = (element.innerText ?? element.textContent ?? '').replace(
          /\r/g,
          ''
        )
        if (maxLength && next.length > maxLength) {
          next = next.slice(0, maxLength)
          element.textContent = next
        }
        Object.defineProperty(element, 'value', {
          configurable: true,
          get: () =>
            (element.innerText ?? element.textContent ?? '').replace(/\r/g, ''),
          set: (text: string) => {
            element.textContent = text
          },
        })
        Object.defineProperty(element, 'name', {
          configurable: true,
          value: name ?? '',
        })
        onChange?.(event as unknown as ChangeEvent<HTMLTextAreaElement>)
      }}
    />
  )
}

export { Textarea }
