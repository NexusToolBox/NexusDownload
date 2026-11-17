import { lexer, type Token, type Tokens } from 'marked'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

export function localizedNotes(text: string, language: string) {
  const halves = text.split(/^\s*---\s*$/m)
  return halves.length > 1
    ? /^zh(?:-|$)/i.test(language)
      ? halves[0]
      : halves.slice(1).join('\n')
    : text
}
function renderTokens(tokens: Token[]): ReactNode {
  const occurrences = new Map<string, number>()
  const keyFor = (raw: string) => {
    const count = occurrences.get(raw) ?? 0
    occurrences.set(raw, count + 1)
    return `${raw}-${count}`
  }
  return tokens.map((token) => {
    const key = keyFor(`${token.type}:${token.raw}`)
    const inline = () => renderTokens((token as Tokens.Paragraph).tokens ?? [])
    switch (token.type) {
      case 'heading':
        return <h3 key={key}>{inline()}</h3>
      case 'paragraph':
        return <p key={key}>{inline()}</p>
      case 'list': {
        const list = token as Tokens.List
        const List = list.ordered ? 'ol' : 'ul'
        return (
          <List key={key}>
            {list.items.map((item) => (
              <li key={keyFor(item.raw)}>{renderTokens(item.tokens)}</li>
            ))}
          </List>
        )
      }
      case 'strong':
        return <strong key={key}>{inline()}</strong>
      case 'em':
        return <em key={key}>{inline()}</em>
      case 'codespan':
        return <code key={key}>{(token as Tokens.Codespan).text}</code>
      case 'code':
        return <pre key={key}>{(token as Tokens.Code).text}</pre>
      case 'blockquote':
        return <blockquote key={key}>{inline()}</blockquote>
      case 'link':
        return <span key={key}>{inline()}</span>
      case 'br':
        return <br key={key} />
      case 'hr':
        return <hr key={key} />
      case 'space':
      case 'html':
        return null
      case 'text':
      case 'escape':
        return (
          <span key={key}>
            {'tokens' in token && token.tokens
              ? renderTokens(token.tokens as Token[])
              : (token as Tokens.Text).text}
          </span>
        )
      default:
        return null
    }
  })
}
export function ReleaseNotes({ text }: { text?: string }) {
  const { t, i18n } = useTranslation()
  return (
    <div className="nx-release-notes">
      {renderTokens(
        lexer(
          localizedNotes(
            text || t('nexus.v13.update.noNotes'),
            i18n.resolvedLanguage ?? i18n.language
          )
        )
      )}
    </div>
  )
}
