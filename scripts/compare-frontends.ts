/**
 * compare-frontends.ts
 *
 * Comprehensive comparison of the React (source of truth) and Vue frontend
 * implementations. Reports errors for things missing in Vue that React has,
 * and warnings for differences that may be intentional.
 *
 * Run with: bun run scripts/compare-frontends.ts
 *
 * Checks:
 *  1.  Component mapping (React <-> Vue)
 *  2.  CSS class comparison (React = source of truth)
 *  3.  API endpoint comparison
 *  4.  Provide/Inject audit (Vue-specific)
 *  5.  Props comparison
 *  6.  Function vs Ref check (Vue useDashboardData first arg)
 *  7.  Formatter usage parity
 *  8.  Core import parity
 *  9.  Loading/Error/Empty state parity
 *  10. Event handler parity
 *  11. Build output verification
 *  12. Hook/Composable return shape comparison
 */

import * as fs from 'fs'
import * as path from 'path'

// ---------------------------------------------------------------------------
// ANSI color helpers
// ---------------------------------------------------------------------------
const RESET = '\x1b[0m'
const BOLD = '\x1b[1m'
const DIM = '\x1b[2m'
const RED = '\x1b[31m'
const GREEN = '\x1b[32m'
const YELLOW = '\x1b[33m'
const CYAN = '\x1b[36m'
const WHITE = '\x1b[37m'
const BG_RED = '\x1b[41m'
const BG_GREEN = '\x1b[42m'
const BG_YELLOW = '\x1b[43m'
const BG_BLUE = '\x1b[44m'

const OK = `${GREEN}\u2705${RESET}`
const WARN = `${YELLOW}\u26A0\uFE0F${RESET}`
const ERR = `${RED}\u274C${RESET}`

// ---------------------------------------------------------------------------
// Counters
// ---------------------------------------------------------------------------
let errors = 0
let warnings = 0
let passes = 0

function pass(msg: string) {
  passes++
  console.log(`  ${OK}  ${msg}`)
}

function warn(msg: string) {
  warnings++
  console.log(`  ${WARN}  ${YELLOW}${msg}${RESET}`)
}

function error(msg: string) {
  errors++
  console.log(`  ${ERR}  ${RED}${msg}${RESET}`)
}

function info(msg: string) {
  console.log(`  ${DIM}${msg}${RESET}`)
}

function header(title: string) {
  console.log()
  console.log(`${BOLD}${BG_BLUE}${WHITE} ${title} ${RESET}`)
  console.log(`${DIM}${'─'.repeat(60)}${RESET}`)
}

function subheader(title: string) {
  console.log(`  ${CYAN}${BOLD}${title}${RESET}`)
}

// ---------------------------------------------------------------------------
// Path constants
// ---------------------------------------------------------------------------
const ROOT = path.resolve((import.meta as unknown as { dir: string }).dir, '..')
const REACT_COMPONENTS = path.join(ROOT, 'src/react/components')
const VUE_COMPONENTS = path.join(ROOT, 'src/vue/components')
const REACT_HOOKS = path.join(ROOT, 'src/react/hooks')
const VUE_COMPOSABLES = path.join(ROOT, 'src/vue/composables')

// ---------------------------------------------------------------------------
// Utility: recursively find files
// ---------------------------------------------------------------------------
function findFiles(dir: string, ext: string): string[] {
  const results: string[] = []
  if (!fs.existsSync(dir)) return results

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      results.push(...findFiles(full, ext))
    } else if (entry.name.endsWith(ext)) {
      results.push(full)
    }
  }
  return results.sort()
}

// ---------------------------------------------------------------------------
// Utility: get relative path from components root
// ---------------------------------------------------------------------------
function relPath(filePath: string, root: string): string {
  return path.relative(root, filePath)
}

function normaliseName(rel: string): string {
  return rel.replace(/\.(tsx|vue)$/, '')
}

function shortName(key: string): string {
  return key.split('/').pop() || key
}

// Known aliases: React name -> Vue name
const ALIASES: Record<string, string> = {
  'Dashboard/shared/Pagination': 'Dashboard/shared/PaginationControls',
}
const REVERSE_ALIASES: Record<string, string> = {}
for (const [k, v] of Object.entries(ALIASES)) {
  REVERSE_ALIASES[v] = k
}

// Known intentional differences between React and Vue component names.
// These are React components that are inlined into Vue counterparts.
const REACT_SHARED_COMPONENTS = new Set([
  'shared/ConfigContent',
  'shared/InternalsContent',
])

// ---------------------------------------------------------------------------
// Matched pair type
// ---------------------------------------------------------------------------
interface MatchedPair {
  key: string
  reactFile: string
  vueFile: string
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. Component Mapping
// ═══════════════════════════════════════════════════════════════════════════
function checkComponentMapping(): MatchedPair[] {
  header('1. Component Mapping')

  const reactFiles = findFiles(REACT_COMPONENTS, '.tsx')
  const vueFiles = findFiles(VUE_COMPONENTS, '.vue')

  const reactRelSet = new Map<string, string>()
  for (const f of reactFiles) {
    reactRelSet.set(normaliseName(relPath(f, REACT_COMPONENTS)), f)
  }

  const vueRelSet = new Map<string, string>()
  for (const f of vueFiles) {
    vueRelSet.set(normaliseName(relPath(f, VUE_COMPONENTS)), f)
  }

  const allKeys = new Set([...reactRelSet.keys(), ...vueRelSet.keys()])

  const matched: MatchedPair[] = []
  const reactOnly: string[] = []
  const vueOnly: string[] = []

  for (const key of allKeys) {
    const hasReact = reactRelSet.has(key)
    const hasVue = vueRelSet.has(key)

    if (hasReact && hasVue) {
      matched.push({ key, reactFile: reactRelSet.get(key)!, vueFile: vueRelSet.get(key)! })
    } else if (hasReact && !hasVue) {
      const aliasKey = ALIASES[key]
      if (aliasKey && vueRelSet.has(aliasKey)) {
        matched.push({ key, reactFile: reactRelSet.get(key)!, vueFile: vueRelSet.get(aliasKey)! })
        allKeys.delete(aliasKey)
      } else {
        reactOnly.push(key)
      }
    } else if (!hasReact && hasVue) {
      const aliasKey = REVERSE_ALIASES[key]
      if (!aliasKey || !reactRelSet.has(aliasKey)) {
        vueOnly.push(key)
      }
    }
  }

  pass(`${matched.length} component pairs matched`)

  for (const r of reactOnly) {
    if (REACT_SHARED_COMPONENTS.has(r)) {
      info(`React shared component "${r}" is inlined in Vue (expected)`)
    } else {
      warn(`React-only component: ${r}.tsx (no Vue equivalent)`)
    }
  }
  for (const v of vueOnly) {
    warn(`Vue-only component: ${v}.vue (no React equivalent)`)
  }

  return matched
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. CSS Class Comparison (React = source of truth)
// ═══════════════════════════════════════════════════════════════════════════
function extractReactClasses(content: string): Set<string> {
  const classes = new Set<string>()

  // className="..." (static)
  const staticRe = /className="([^"]+)"/g
  let m: RegExpExecArray | null
  while ((m = staticRe.exec(content)) !== null) {
    for (const cls of m[1].split(/\s+/)) {
      if (cls && !cls.includes('$') && !cls.includes('{')) {
        classes.add(cls.trim())
      }
    }
  }

  // className={`...`} (template literals)
  const templateRe = /className=\{`([^`]+)`\}/g
  while ((m = templateRe.exec(content)) !== null) {
    const parts = m[1].replace(/\$\{[^}]*\}/g, ' ').split(/\s+/)
    for (const cls of parts) {
      if (cls && cls.startsWith('ss-')) classes.add(cls.trim())
    }
  }

  // className={clsx(...)} or ternary expressions like className={x ? 'ss-a' : 'ss-a ss-b'}
  const clsxRe = /className=\{[^}]*'(ss-[^']+)'[^}]*\}/g
  while ((m = clsxRe.exec(content)) !== null) {
    // Split space-separated classes (e.g., 'ss-bar ss-hidden' -> ['ss-bar', 'ss-hidden'])
    for (const cls of m[1].trim().split(/\s+/)) {
      if (cls && cls.startsWith('ss-')) classes.add(cls)
    }
  }

  return classes
}

function extractVueClasses(content: string): Set<string> {
  const classes = new Set<string>()

  // Extract template section (use greedy match to capture nested <template> tags)
  const templateMatch = content.match(/<template>([\s\S]*)<\/template>/)
  if (!templateMatch) return classes
  const template = templateMatch[1]

  // class="..." (static)
  const staticRe = /\bclass="([^"]+)"/g
  let m: RegExpExecArray | null
  while ((m = staticRe.exec(template)) !== null) {
    for (const cls of m[1].split(/\s+/)) {
      if (cls && !cls.includes('{') && !cls.includes("'")) {
        classes.add(cls.trim())
      }
    }
  }

  // :class="[...]" or :class="{...}" or :class="`...`"
  const dynRe = /:class="([^"]+)"/g
  while ((m = dynRe.exec(template)) !== null) {
    const expr = m[1]

    // Single-quoted class names: 'ss-dash-foo'
    const strRe = /'(ss-[^']+)'/g
    let sm: RegExpExecArray | null
    while ((sm = strRe.exec(expr)) !== null) {
      classes.add(sm[1].trim())
    }

    // Backtick template literals: `ss-dash-btn ${...}`
    // Strip ${...} interpolations, then extract ss-* tokens
    const backtickMatch = expr.match(/^`([^`]+)`$/)
    if (backtickMatch) {
      const literal = backtickMatch[1].replace(/\$\{[^}]*\}/g, ' ')
      for (const cls of literal.split(/\s+/)) {
        if (cls && cls.startsWith('ss-')) classes.add(cls.trim())
      }
    }
  }

  // Also extract from script (computed classes, template literals in h() calls)
  // But filter out provide/inject key strings that look like CSS classes
  const INJECT_KEYS = new Set([
    'ss-refresh-key', 'ss-base-url', 'ss-dashboard-endpoint',
    'ss-debug-endpoint', 'ss-auth-token',
  ])
  const scriptMatch = content.match(/<script[^>]*>([\s\S]*?)<\/script>/)
  if (scriptMatch) {
    const script = scriptMatch[1]
    // Only extract class names used in class-assignment contexts (not inject/provide)
    // Look for: class: 'ss-...', className: 'ss-...', classList patterns, or template literals
    // in h() render function calls
    const hCallClassRe = /(?:class|className)\s*:\s*['"`](ss-[a-z][\w-]+)/g
    while ((m = hCallClassRe.exec(script)) !== null) {
      if (!INJECT_KEYS.has(m[1])) classes.add(m[1].trim())
    }
    // Template literal class names in h() calls: `ss-dash-foo ${...}`
    const backtickClassRe = /(?:class|className)\s*:\s*`(ss-[a-z][\w-]+)/g
    while ((m = backtickClassRe.exec(script)) !== null) {
      if (!INJECT_KEYS.has(m[1])) classes.add(m[1].trim())
    }
    // Also pick up CSS class names used in string comparisons or returns
    // e.g. return 'ss-dash-very-slow' or case 'ss-dash-method-GET'
    const returnClassRe = /(?:return|case|===?)\s*['"`](ss-(?:dash|dbg)-[a-z][\w-]*)/g
    while ((m = returnClassRe.exec(script)) !== null) {
      if (!INJECT_KEYS.has(m[1])) classes.add(m[1].trim())
    }
    // Pick up space-separated ss-* classes in quoted return strings
    // e.g. return 'ss-dbg-duration ss-dbg-slow' → extract both classes
    const returnMultiClassRe = /(?:return|case|===?)\s*'([^']*ss-[^']*)'/g
    while ((m = returnMultiClassRe.exec(script)) !== null) {
      for (const cls of m[1].split(/\s+/)) {
        if (cls.startsWith('ss-') && !INJECT_KEYS.has(cls)) classes.add(cls.trim())
      }
    }
    // Pick up ss-* class prefixes from template literal returns with ${...}
    // e.g. return `ss-dbg-method ss-dbg-method-${value}` → extract 'ss-dbg-method' and 'ss-dbg-method-'
    const returnTemplateLitRe = /(?:return|case|===?)\s*`([^`]*)`/g
    while ((m = returnTemplateLitRe.exec(script)) !== null) {
      const literal = m[1].replace(/\$\{[^}]*\}/g, ' ')
      for (const cls of literal.split(/\s+/)) {
        if (cls.startsWith('ss-') && !INJECT_KEYS.has(cls)) classes.add(cls.trim())
      }
    }
  }

  return classes
}

// Known architectural class relocations: classes that exist in a different Vue
// component than their React counterpart due to structural differences.
// Key: component short name, Value: set of classes that are handled elsewhere in Vue.
const CSS_CLASS_RELOCATIONS: Record<string, Set<string>> = {
  // In React, the wrench button (ss-dbg-btn) is rendered inside DebugPanel.
  // In Vue, it's rendered inside StatsBar (architectural difference).
  'DebugPanel': new Set(['ss-dbg-btn']),
}

function checkCssClasses(matched: MatchedPair[]) {
  header('2. CSS Class Comparison (React = source of truth)')

  let missingFromVue = 0
  let extraInVue = 0

  for (const pair of matched) {
    const reactContent = fs.readFileSync(pair.reactFile, 'utf-8')
    const vueContent = fs.readFileSync(pair.vueFile, 'utf-8')

    const reactClasses = extractReactClasses(reactContent)
    const vueClasses = extractVueClasses(vueContent)

    const reactSS = new Set([...reactClasses].filter((c) => c.startsWith('ss-')))
    const vueSS = new Set([...vueClasses].filter((c) => c.startsWith('ss-')))

    if (reactSS.size === 0 && vueSS.size === 0) continue

    // Filter out classes that are known to be relocated to a different Vue component
    const name = shortName(pair.key)
    const relocated = CSS_CLASS_RELOCATIONS[name] || new Set()
    const relocatedFound = [...reactSS].filter((c) => !vueSS.has(c) && relocated.has(c))
    if (relocatedFound.length > 0) {
      info(`${name}: ${relocatedFound.join(', ')} relocated to different Vue component (OK)`)
    }
    const inReactNotVue = [...reactSS].filter((c) => !vueSS.has(c) && !relocated.has(c))
    const inVueNotReact = [...vueSS].filter((c) => !reactSS.has(c))

    if (inReactNotVue.length === 0 && inVueNotReact.length === 0) {
      pass(`${pair.key}: ${reactSS.size} shared classes match`)
    } else {
      if (inReactNotVue.length > 0) {
        missingFromVue += inReactNotVue.length
        // React is source of truth - missing classes in Vue are errors
        error(`${name}: ${inReactNotVue.length} React class(es) MISSING from Vue: ${inReactNotVue.join(', ')}`)
      }
      if (inVueNotReact.length > 0) {
        extraInVue += inVueNotReact.length
        warn(`${name}: ${inVueNotReact.length} extra class(es) in Vue (not in React): ${inVueNotReact.join(', ')}`)
      }
    }
  }

  if (missingFromVue === 0 && extraInVue === 0) {
    pass('All ss-* CSS classes are consistent across frameworks')
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. API Endpoint Comparison
// ═══════════════════════════════════════════════════════════════════════════
function extractEndpoints(content: string, framework: 'react' | 'vue'): string[] {
  const endpoints: string[] = []

  if (framework === 'react') {
    const callRe = /useDashboardData/g
    let m: RegExpExecArray | null
    while ((m = callRe.exec(content)) !== null) {
      let i = m.index + m[0].length
      if (content[i] === '<') {
        let depth = 1
        i++
        while (i < content.length && depth > 0) {
          if (content[i] === '<') depth++
          else if (content[i] === '>') depth--
          i++
        }
      }
      while (i < content.length && /\s/.test(content[i])) i++
      if (content[i] !== '(') continue
      i++
      while (i < content.length && /\s/.test(content[i])) i++

      if (content[i] === "'" || content[i] === '"') {
        const quote = content[i]
        i++
        const start = i
        while (i < content.length && content[i] !== quote) i++
        endpoints.push(content.slice(start, i))
      } else {
        const idMatch = content.slice(i).match(/^([a-zA-Z_]\w*)/)
        if (idMatch) {
          const varName = idMatch[1]
          const ternRe = new RegExp(
            `(?:const|let|var)\\s+${varName}\\s*=\\s*[^\\n]*\\?\\s*['"]([^'"]+)['"]\\s*:\\s*['"]([^'"]+)['"]`
          )
          const tm = ternRe.exec(content)
          if (tm) {
            endpoints.push(tm[1])
            endpoints.push(tm[2])
          }
          const simpleRe = new RegExp(`(?:const|let|var)\\s+${varName}\\s*=\\s*['"]([^'"]+)['"]`)
          const sm = simpleRe.exec(content)
          if (sm) endpoints.push(sm[1])
        }
      }
    }
  } else {
    const re = /useDashboardData\(\s*\(\)\s*=>\s*['"]([^'"]+)['"]/g
    let m: RegExpExecArray | null
    while ((m = re.exec(content)) !== null) {
      endpoints.push(m[1].replace(/\s+as\s+const$/, ''))
    }
    const dynRe = /useDashboardData\(\s*\(\)\s*=>\s*(\w+)\.value/g
    while ((m = dynRe.exec(content)) !== null) {
      const varName = m[1]
      const compRe = new RegExp(
        `const\\s+${varName}\\s*=\\s*computed\\(\\s*\\(\\)\\s*=>\\s*[^?]*\\?\\s*['"]([^'"]+)['"]\\s*:\\s*['"]([^'"]+)['"]`,
        'g'
      )
      let cm: RegExpExecArray | null
      while ((cm = compRe.exec(content)) !== null) {
        endpoints.push(cm[1])
        endpoints.push(cm[2])
      }
    }
  }

  return [...new Set(endpoints)].sort()
}

function checkApiEndpoints() {
  header('3. API Endpoint Comparison')

  const reactHookFiles = findFiles(REACT_HOOKS, '.ts')
  const vueComposableFiles = findFiles(VUE_COMPOSABLES, '.ts')
  const reactSectionFiles = findFiles(path.join(REACT_COMPONENTS, 'Dashboard'), '.tsx')
  const vueSectionFiles = findFiles(path.join(VUE_COMPONENTS, 'Dashboard'), '.vue')

  const allReactFiles = [...reactHookFiles, ...reactSectionFiles]
  const allVueFiles = [...vueComposableFiles, ...vueSectionFiles]

  const reactEndpoints = new Set<string>()
  const vueEndpoints = new Set<string>()

  for (const f of allReactFiles) {
    for (const ep of extractEndpoints(fs.readFileSync(f, 'utf-8'), 'react')) {
      reactEndpoints.add(ep)
    }
  }

  for (const f of allVueFiles) {
    for (const ep of extractEndpoints(fs.readFileSync(f, 'utf-8'), 'vue')) {
      vueEndpoints.add(ep)
    }
  }

  subheader('React endpoints:')
  for (const ep of [...reactEndpoints].sort()) info(ep)
  subheader('Vue endpoints:')
  for (const ep of [...vueEndpoints].sort()) info(ep)

  const inReactOnly = [...reactEndpoints].filter((e) => !vueEndpoints.has(e))
  const inVueOnly = [...vueEndpoints].filter((e) => !reactEndpoints.has(e))

  if (inReactOnly.length === 0 && inVueOnly.length === 0) {
    pass('All API endpoints match between React and Vue')
  } else {
    for (const ep of inReactOnly) error(`Endpoint "${ep}" in React but NOT Vue`)
    for (const ep of inVueOnly) warn(`Endpoint "${ep}" in Vue but NOT React`)
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. Provide/Inject Audit (Vue-specific)
// ═══════════════════════════════════════════════════════════════════════════
function checkProvideInject() {
  header('4. Provide/Inject Audit (Vue)')

  const allVueFiles = findFiles(VUE_COMPONENTS, '.vue')

  const provides = new Map<string, string[]>()
  const injects = new Map<string, string[]>()

  for (const f of allVueFiles) {
    const content = fs.readFileSync(f, 'utf-8')
    const name = relPath(f, VUE_COMPONENTS)

    const provideRe = /provide\(\s*['"]([^'"]+)['"]/g
    let m: RegExpExecArray | null
    while ((m = provideRe.exec(content)) !== null) {
      const key = m[1]
      if (!provides.has(key)) provides.set(key, [])
      provides.get(key)!.push(name)
    }

    const injectCallRe = /\binject\s*(?:<|(?=\())/g
    let im: RegExpExecArray | null
    while ((im = injectCallRe.exec(content)) !== null) {
      let idx = im.index + im[0].length
      if (content[idx - 1] === '<') {
        let depth = 1
        while (idx < content.length && depth > 0) {
          if (content[idx] === '<') depth++
          else if (content[idx] === '>') depth--
          idx++
        }
      }
      while (idx < content.length && /\s/.test(content[idx])) idx++
      if (content[idx] !== '(') continue
      idx++
      while (idx < content.length && /\s/.test(content[idx])) idx++
      if (content[idx] === "'" || content[idx] === '"') {
        const quote = content[idx]
        idx++
        const start = idx
        while (idx < content.length && content[idx] !== quote) idx++
        const key = content.slice(start, idx)
        if (!injects.has(key)) injects.set(key, [])
        injects.get(key)!.push(name)
      }
    }
  }

  subheader('Provided keys:')
  for (const [key, files] of provides) info(`${key} → ${files.join(', ')}`)

  subheader('Injected keys:')
  for (const [key, files] of injects) info(`${key} ← ${files.join(', ')}`)

  for (const key of provides.keys()) {
    if (injects.has(key)) {
      pass(`Provided key "${key}" is injected in ${injects.get(key)!.length} component(s)`)
    } else {
      warn(`Provided key "${key}" is never injected anywhere`)
    }
  }

  for (const key of injects.keys()) {
    if (provides.has(key)) {
      pass(`Injected key "${key}" is provided`)
    } else {
      error(`Injected key "${key}" is NEVER provided (will be undefined!)`)
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. Props Comparison
// ═══════════════════════════════════════════════════════════════════════════
interface PropInfo {
  name: string
  type: string
  optional: boolean
}

function extractReactProps(content: string): PropInfo[] {
  const props: PropInfo[] = []
  const ifaceRe = /interface\s+\w*Props\s*\{([^}]*)\}/gs
  let m: RegExpExecArray | null
  while ((m = ifaceRe.exec(content)) !== null) {
    const propRe = /^\s*(?:\/\*\*[^*]*\*\/\s*)?(\w+)(\??)\s*:\s*([^\n;]+)/gm
    let pm: RegExpExecArray | null
    while ((pm = propRe.exec(m[1])) !== null) {
      props.push({ name: pm[1], type: pm[3].trim().replace(/\s+/g, ' '), optional: pm[2] === '?' })
    }
  }
  return props
}

function extractVueProps(content: string): PropInfo[] {
  const props: PropInfo[] = []
  const scriptMatch = content.match(/<script[^>]*>([\s\S]*?)<\/script>/)
  if (!scriptMatch) return props
  const script = scriptMatch[1]

  // defineProps<{ ... }>()
  const dpRe = /defineProps<\s*\{([\s\S]*?)\}>\s*\(\)/g
  let m: RegExpExecArray | null
  while ((m = dpRe.exec(script)) !== null) {
    const propRe = /^\s*(?:\/\*\*[^*]*\*\/\s*)?(\w+)(\??)\s*:\s*([^\n;]+)/gm
    let pm: RegExpExecArray | null
    while ((pm = propRe.exec(m[1])) !== null) {
      props.push({ name: pm[1], type: pm[3].trim().replace(/\s+/g, ' '), optional: pm[2] === '?' })
    }
  }

  // withDefaults(defineProps<Interface>(), { ... })
  const wdRe = /withDefaults\(\s*defineProps<(\w+)>/g
  while ((m = wdRe.exec(script)) !== null) {
    const ifaceRe = new RegExp(`interface\\s+${m[1]}\\s*\\{([^}]*)\\}`, 'gs')
    let im: RegExpExecArray | null
    while ((im = ifaceRe.exec(script)) !== null) {
      const propRe = /^\s*(?:\/\*\*[^*]*\*\/\s*)?(\w+)(\??)\s*:\s*([^\n;]+)/gm
      let pm: RegExpExecArray | null
      while ((pm = propRe.exec(im[1])) !== null) {
        props.push({ name: pm[1], type: pm[3].trim().replace(/\s+/g, ' '), optional: pm[2] === '?' })
      }
    }
  }

  // withDefaults(defineProps<{ ... }>(), ...)
  const wdInlineRe = /withDefaults\(\s*defineProps<\s*\{([\s\S]*?)\}>\s*\(\)/g
  while ((m = wdInlineRe.exec(script)) !== null) {
    const propRe = /^\s*(?:\/\*\*[^*]*\*\/\s*)?(\w+)(\??)\s*:\s*([^\n;]+)/gm
    let pm: RegExpExecArray | null
    while ((pm = propRe.exec(m[1])) !== null) {
      props.push({ name: pm[1], type: pm[3].trim().replace(/\s+/g, ' '), optional: pm[2] === '?' })
    }
  }

  return props
}

function checkProps(matched: MatchedPair[]) {
  header('5. Props Comparison')

  let anyDiff = false

  for (const pair of matched) {
    const reactContent = fs.readFileSync(pair.reactFile, 'utf-8')
    const vueContent = fs.readFileSync(pair.vueFile, 'utf-8')

    const reactProps = extractReactProps(reactContent)
    const vueProps = extractVueProps(vueContent)

    if (reactProps.length === 0 && vueProps.length === 0) continue

    const name = shortName(pair.key)
    const reactPropNames = new Set(reactProps.map((p) => p.name))
    const vuePropNames = new Set(vueProps.map((p) => p.name))

    // React-specific props that won't exist in Vue
    const reactSpecific = new Set(['children', 'className', 'key', 'ref'])
    // Vue-specific prop naming conventions (v-model pattern)
    const vueIdiomatic = new Set(['modelValue'])

    const inReactOnly = [...reactPropNames].filter(
      (n) => !vuePropNames.has(n) && !reactSpecific.has(n)
    )
    const inVueOnly = [...vuePropNames].filter(
      (n) => !reactPropNames.has(n) && !vueIdiomatic.has(n)
    )

    if (inReactOnly.length === 0 && inVueOnly.length === 0 && reactProps.length > 0) {
      pass(`${name}: ${reactProps.length} React props, ${vueProps.length} Vue props match`)
    } else {
      // Skip sections/tabs that use inject in Vue (architectural difference)
      if (pair.key.includes('sections/') || pair.key.includes('tabs/')) continue
      if (reactProps.length === 0 && vueProps.length <= 2) continue
      if (vueProps.length === 0 && reactProps.length > 0) continue

      for (const p of inReactOnly) {
        anyDiff = true
        warn(`${name}: prop "${p}" in React but not Vue`)
      }
      for (const p of inVueOnly) {
        anyDiff = true
        warn(`${name}: prop "${p}" in Vue but not React`)
      }
    }

    // Optionality comparison for shared props
    for (const rp of reactProps) {
      const vp = vueProps.find((v) => v.name === rp.name)
      if (!vp) continue
      if (rp.optional !== vp.optional) {
        anyDiff = true
        warn(`${name}: prop "${rp.name}" optionality differs (React: ${rp.optional ? 'optional' : 'required'}, Vue: ${vp.optional ? 'optional' : 'required'})`)
      }
    }
  }

  if (!anyDiff) pass('All comparable props are consistent between frameworks')
}

// ═══════════════════════════════════════════════════════════════════════════
// 6. Function vs Ref Check (Vue useDashboardData first arg)
// ═══════════════════════════════════════════════════════════════════════════
function checkFunctionVsRef() {
  header('6. Function vs Ref Check (Vue useDashboardData)')

  const allVueFiles = [
    ...findFiles(VUE_COMPONENTS, '.vue'),
    ...findFiles(VUE_COMPOSABLES, '.ts'),
  ]

  let anyIssue = false

  for (const f of allVueFiles) {
    const content = fs.readFileSync(f, 'utf-8')
    const name = relPath(f, path.join(ROOT, 'src/vue'))

    if (name.includes('composables/useDashboardData')) continue

    const callRe = /useDashboardData\(/g
    let m: RegExpExecArray | null
    while ((m = callRe.exec(content)) !== null) {
      const startIdx = m.index + m[0].length
      let depth = 0
      let endIdx = startIdx
      for (let i = startIdx; i < content.length; i++) {
        const ch = content[i]
        if (ch === '(' || ch === '[' || ch === '{') depth++
        else if (ch === ')' || ch === ']' || ch === '}') {
          if (depth === 0) { endIdx = i; break }
          depth--
        } else if (ch === ',' && depth === 0) {
          endIdx = i
          break
        }
      }

      const firstArg = content.slice(startIdx, endIdx).trim()

      if (/^\(\s*\)\s*=>/.test(firstArg)) {
        pass(`${name}: useDashboardData uses getter function`)
        continue
      }

      if (firstArg.startsWith("'") || firstArg.startsWith('"')) {
        pass(`${name}: useDashboardData uses string literal: ${firstArg}`)
        continue
      }

      if (/^[a-zA-Z_]\w*$/.test(firstArg)) {
        anyIssue = true
        error(`${name}: useDashboardData passes raw ref/variable "${firstArg}" — use () => ${firstArg}.value`)
        continue
      }

      warn(`${name}: useDashboardData first arg is unusual: ${firstArg.substring(0, 50)}`)
    }
  }

  if (!anyIssue) pass('All Vue useDashboardData calls use correct getter functions')
}

// ═══════════════════════════════════════════════════════════════════════════
// 7. Formatter Usage Parity
// ═══════════════════════════════════════════════════════════════════════════
const TRACKED_FORMATTERS = [
  'formatDuration',
  'formatTime',
  'timeAgo',
  'formatBytes',
  'formatMb',
  'formatCount',
  'formatUptime',
  'formatStatNum',
  'durationSeverity',
  'compactPreview',
  'shortReqId',
  'statusColor',
  'getThresholdColor',
  'getRatioColor',
]

function extractFormatterUsage(content: string): Set<string> {
  const used = new Set<string>()
  for (const fn of TRACKED_FORMATTERS) {
    // Match function calls: fn( or fn<...>(
    // But avoid matching imports: import { fn } or from '...fn...'
    const callRe = new RegExp(`\\b${fn}\\s*[<(]`, 'g')
    const importRe = new RegExp(`import\\s+.*${fn}`, 'g')
    if (callRe.test(content)) {
      // Verify it's actually called, not just imported
      const lines = content.split('\n')
      for (const line of lines) {
        if (importRe.test(line)) continue
        if (new RegExp(`\\b${fn}\\s*[<(]`).test(line)) {
          used.add(fn)
          break
        }
      }
    }
  }
  return used
}

function checkFormatterUsage(matched: MatchedPair[]) {
  header('7. Formatter Usage Parity')

  let missingCount = 0

  for (const pair of matched) {
    const reactContent = fs.readFileSync(pair.reactFile, 'utf-8')
    const vueContent = fs.readFileSync(pair.vueFile, 'utf-8')

    const reactFormatters = extractFormatterUsage(reactContent)
    const vueFormatters = extractFormatterUsage(vueContent)

    if (reactFormatters.size === 0) continue

    const name = shortName(pair.key)

    const inReactNotVue = [...reactFormatters].filter((f) => !vueFormatters.has(f))
    const inVueNotReact = [...vueFormatters].filter((f) => !reactFormatters.has(f))

    if (inReactNotVue.length === 0 && inVueNotReact.length === 0) {
      pass(`${name}: ${reactFormatters.size} formatter(s) match`)
    } else {
      for (const fn of inReactNotVue) {
        missingCount++
        error(`${name}: formatter "${fn}" used in React but NOT Vue`)
      }
      for (const fn of inVueNotReact) {
        warn(`${name}: formatter "${fn}" used in Vue but NOT React`)
      }
    }
  }

  if (missingCount === 0) pass('All React formatters are used in their Vue counterparts')
}

// ═══════════════════════════════════════════════════════════════════════════
// 8. Core Import Parity
// ═══════════════════════════════════════════════════════════════════════════
const TRACKED_CORE_IMPORTS = [
  'ApiClient',
  'UnauthorizedError',
  'DashboardApi',
  'initResizableColumns',
  'buildSparklineData',
  'computeStats',
  'getPageNumbers',
  'subscribeToChannel',
  'buildQueryParams',
]

function extractCoreImports(content: string): Set<string> {
  const imports = new Set<string>()

  // Extract all imported symbols (handles both single-line and multi-line imports)
  const importedSymbols = new Set<string>()
  const importBlockRe = /import\s*\{([^}]+)\}\s*from\s*['"][^'"]+['"]/g
  let im: RegExpExecArray | null
  while ((im = importBlockRe.exec(content)) !== null) {
    for (const sym of im[1].split(',')) {
      const name = sym.replace(/\s+as\s+\w+/, '').trim()
      if (name) importedSymbols.add(name)
    }
  }
  // Also handle: import X from '...' (default imports)
  const defaultImportRe = /import\s+(\w+)\s+from\s*['"][^'"]+['"]/g
  while ((im = defaultImportRe.exec(content)) !== null) {
    importedSymbols.add(im[1])
  }

  for (const sym of TRACKED_CORE_IMPORTS) {
    const isImported = importedSymbols.has(sym)
    if (!isImported) continue

    // Make sure it's actually used (not just imported)
    const lines = content.split('\n')
    let isUsed = false
    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue
      if (/^import\b/.test(trimmed)) continue
      // Skip lines that are part of multi-line import blocks
      if (/^\s*\w+\s*,?\s*$/.test(trimmed) || /^}\s*from\b/.test(trimmed)) continue
      if (new RegExp(`\\b${sym}\\b`).test(trimmed)) {
        isUsed = true
        break
      }
    }
    if (isUsed) imports.add(sym)
  }
  return imports
}

function checkCoreImports(matched: MatchedPair[]) {
  header('8. Core Import Parity')

  let missingCount = 0

  for (const pair of matched) {
    const reactContent = fs.readFileSync(pair.reactFile, 'utf-8')
    const vueContent = fs.readFileSync(pair.vueFile, 'utf-8')

    const reactImports = extractCoreImports(reactContent)
    const vueImports = extractCoreImports(vueContent)

    if (reactImports.size === 0) continue

    const name = shortName(pair.key)

    const inReactNotVue = [...reactImports].filter((i) => !vueImports.has(i))

    if (inReactNotVue.length === 0) {
      pass(`${name}: ${reactImports.size} core import(s) match`)
    } else {
      for (const imp of inReactNotVue) {
        missingCount++
        // initResizableColumns might be handled by a shared DataTable in Vue
        if (imp === 'initResizableColumns') {
          warn(`${name}: core import "${imp}" in React but not Vue (may be in shared DataTable)`)
          missingCount-- // Don't count as error
        } else {
          error(`${name}: core import "${imp}" used in React but NOT Vue`)
        }
      }
    }
  }

  if (missingCount === 0) pass('All core imports are consistent')
}

// ═══════════════════════════════════════════════════════════════════════════
// 9. Loading/Error/Empty State Parity
// ═══════════════════════════════════════════════════════════════════════════
function hasPattern(content: string, pattern: RegExp): boolean {
  return pattern.test(content)
}

function checkStatePatterns(matched: MatchedPair[]) {
  header('9. Loading/Error/Empty State Parity')

  let issueCount = 0

  // Define state patterns for each framework
  const checks = [
    {
      name: 'Loading state',
      reactPattern: /isLoading|loading/i,
      reactRenderPattern: /loading|spinner|skeleton/i,
      vuePattern: /loading/i,
      // Vue patterns: v-if/v-else-if="loading...", v-show="loading...", Loading..., etc.
      vueRenderPattern: /v-(?:else-)?if="[^"]*loading|v-show="[^"]*loading|Loading\.\.\./i,
    },
    {
      name: 'Error handling',
      reactPattern: /\berror\b/,
      reactRenderPattern: /error\.message|Error:|error\b/,
      vuePattern: /\berror\b/,
      // Vue patterns: v-if/v-else-if="error", {{ error.message }}, Error: {{ error }}
      vueRenderPattern: /v-(?:else-)?if="[^"]*error|error\.message|Error:/,
    },
    {
      name: 'Empty state',
      reactPattern: /length\s*===?\s*0|!data|\.length\b/,
      reactRenderPattern: /no\s+\w+|empty|ss-\w*-empty/i,
      vuePattern: /length\s*===?\s*0|!data|\.length\b/,
      vueRenderPattern: /no\s+\w+|empty|ss-\w*-empty/i,
    },
  ]

  // Vue DebugPanel pre-fetches data for all tabs, so individual tabs don't need
  // their own loading/error states — the parent DebugPanel handles it.
  // Only Dashboard sections manage their own loading/error states.
  const dashboardPairs = matched.filter((p) => p.key.includes('sections/'))
  const tabPairs = matched.filter((p) => p.key.includes('tabs/'))

  // Check dashboard sections (both frameworks manage their own state)
  subheader('Dashboard sections:')
  for (const pair of dashboardPairs) {
    const reactContent = fs.readFileSync(pair.reactFile, 'utf-8')
    const vueContent = fs.readFileSync(pair.vueFile, 'utf-8')
    const name = shortName(pair.key)

    for (const check of checks) {
      const reactHasState = hasPattern(reactContent, check.reactPattern)
      const reactRendersState = hasPattern(reactContent, check.reactRenderPattern)
      const vueHasState = hasPattern(vueContent, check.vuePattern)
      const vueRendersState = hasPattern(vueContent, check.vueRenderPattern)

      if (reactHasState && reactRendersState && (!vueHasState || !vueRendersState)) {
        issueCount++
        error(`${name}: React has ${check.name} rendering but Vue does not`)
      }
    }
  }

  // Check debug tabs (Vue tabs receive pre-fetched data, so missing loading/error is expected)
  subheader('Debug panel tabs (Vue receives pre-fetched data from parent):')
  for (const pair of tabPairs) {
    const reactContent = fs.readFileSync(pair.reactFile, 'utf-8')
    const vueContent = fs.readFileSync(pair.vueFile, 'utf-8')
    const name = shortName(pair.key)

    // Only check empty states for tabs (both frameworks should handle "no data")
    const emptyCheck = checks[2] // Empty state
    const reactHasEmpty = hasPattern(reactContent, emptyCheck.reactPattern)
    const reactRendersEmpty = hasPattern(reactContent, emptyCheck.reactRenderPattern)
    const vueHasEmpty = hasPattern(vueContent, emptyCheck.vuePattern)
    const vueRendersEmpty = hasPattern(vueContent, emptyCheck.vueRenderPattern)

    if (reactHasEmpty && reactRendersEmpty && (!vueHasEmpty || !vueRendersEmpty)) {
      issueCount++
      error(`${name}: React has Empty state rendering but Vue does not`)
    }

    // Loading/error in tabs is just a warning since Vue architecture differs
    for (const check of checks.slice(0, 2)) {
      const reactHasState = hasPattern(reactContent, check.reactPattern)
      const reactRendersState = hasPattern(reactContent, check.reactRenderPattern)
      const vueHasState = hasPattern(vueContent, check.vuePattern)
      const vueRendersState = hasPattern(vueContent, check.vueRenderPattern)

      if (reactHasState && reactRendersState && (!vueHasState || !vueRendersState)) {
        info(`${name}: ${check.name} handled by Vue DebugPanel parent (OK)`)
      }
    }
  }

  // Check for isUnauthorized handling
  subheader('Authorization handling:')
  for (const pair of [...dashboardPairs, ...tabPairs]) {
    const reactContent = fs.readFileSync(pair.reactFile, 'utf-8')
    const vueContent = fs.readFileSync(pair.vueFile, 'utf-8')
    const name = shortName(pair.key)

    const reactHasAuth = /unauthorized|UnauthorizedError|403/i.test(reactContent)
    const vueHasAuth = /isUnauthorized|unauthorized|UnauthorizedError|403/i.test(vueContent)

    if (reactHasAuth && !vueHasAuth) {
      warn(`${name}: React handles authorization but Vue does not`)
    }
  }

  if (issueCount === 0) pass('All loading/error/empty states are handled in both frameworks')
}

// ═══════════════════════════════════════════════════════════════════════════
// 10. Event Handler Parity
// ═══════════════════════════════════════════════════════════════════════════
function countReactHandlers(content: string): Map<string, number> {
  const counts = new Map<string, number>()
  const patterns: [string, RegExp][] = [
    ['click', /onClick\s*[={]/g],
    ['change', /onChange\s*[={]/g],
    ['submit', /onSubmit\s*[={]/g],
    ['keydown', /onKeyDown\s*[={]/g],
    ['keyup', /onKeyUp\s*[={]/g],
    ['mouseenter', /onMouseEnter\s*[={]/g],
    ['mouseleave', /onMouseLeave\s*[={]/g],
    ['mousemove', /onMouseMove\s*[={]/g],
    ['scroll', /onScroll\s*[={]/g],
  ]
  for (const [name, re] of patterns) {
    const matches = content.match(re)
    if (matches) counts.set(name, matches.length)
  }
  return counts
}

function countVueHandlers(content: string): Map<string, number> {
  const counts = new Map<string, number>()
  // Use greedy match to capture all template content including nested <template> tags
  const templateMatch = content.match(/<template>([\s\S]*)<\/template>/)
  if (!templateMatch) return counts
  const template = templateMatch[1]

  const patterns: [string, RegExp][] = [
    ['click', /@click[.=]/g],
    // Vue uses v-model instead of onChange for form inputs, so count both
    ['change', /@change[.=]/g],
    ['submit', /@submit[.=]/g],
    ['keydown', /@keydown[.=]/g],
    ['keyup', /@keyup[.=]/g],
    ['mouseenter', /@mouseenter[.=]/g],
    ['mouseleave', /@mouseleave[.=]/g],
    ['mousemove', /@mousemove[.=]/g],
    ['scroll', /@scroll[.=]/g],
  ]
  for (const [name, re] of patterns) {
    const matches = template.match(re)
    if (matches) counts.set(name, matches.length)
  }
  // Count v-model as equivalent to 'change' handlers (Vue's replacement for onChange)
  const vModelMatches = template.match(/v-model[.=]/g)
  if (vModelMatches) {
    counts.set('change', (counts.get('change') || 0) + vModelMatches.length)
  }
  // Count @input as equivalent to 'change' handlers
  const inputMatches = template.match(/@input[.=]/g)
  if (inputMatches) {
    counts.set('change', (counts.get('change') || 0) + inputMatches.length)
  }
  // Count @update:modelValue as equivalent to 'change'
  const updateMatches = template.match(/@update:model-?[Vv]alue/g)
  if (updateMatches) {
    counts.set('change', (counts.get('change') || 0) + updateMatches.length)
  }
  return counts
}

function checkEventHandlers(matched: MatchedPair[]) {
  header('10. Event Handler Parity')

  let issueCount = 0

  for (const pair of matched) {
    const reactContent = fs.readFileSync(pair.reactFile, 'utf-8')
    const vueContent = fs.readFileSync(pair.vueFile, 'utf-8')

    const reactHandlers = countReactHandlers(reactContent)
    const vueHandlers = countVueHandlers(vueContent)

    if (reactHandlers.size === 0) continue

    const name = shortName(pair.key)

    for (const [event, reactCount] of reactHandlers) {
      const vueCount = vueHandlers.get(event) || 0

      if (reactCount > 0 && vueCount === 0) {
        issueCount++
        error(`${name}: React has ${reactCount} "${event}" handler(s) but Vue has NONE`)
      } else if (reactCount > 0 && vueCount > 0) {
        // Just note significant count differences
        const diff = Math.abs(reactCount - vueCount)
        if (diff > 2) {
          warn(`${name}: "${event}" handler count differs significantly (React: ${reactCount}, Vue: ${vueCount})`)
        }
      }
    }
  }

  if (issueCount === 0) pass('All React event handlers have Vue counterparts')
}

// ═══════════════════════════════════════════════════════════════════════════
// 11. Build Output Verification
// ═══════════════════════════════════════════════════════════════════════════
function checkBuildOutput() {
  header('11. Build Output Verification')

  const preactDir = path.join(ROOT, 'src/edge/client')
  const vueDir = path.join(ROOT, 'src/edge/client-vue')

  const expectedBundles = ['stats-bar.js', 'debug-panel.js', 'dashboard.js']

  subheader('Preact bundles:')
  for (const bundle of expectedBundles) {
    const f = path.join(preactDir, bundle)
    if (fs.existsSync(f)) {
      const size = fs.statSync(f).size
      pass(`${bundle}: ${(size / 1024).toFixed(1)} KB`)
    } else {
      error(`${bundle}: MISSING from ${preactDir}`)
    }
  }

  subheader('Vue bundles:')
  for (const bundle of expectedBundles) {
    const f = path.join(vueDir, bundle)
    if (fs.existsSync(f)) {
      const size = fs.statSync(f).size
      pass(`${bundle}: ${(size / 1024).toFixed(1)} KB`)
    } else {
      error(`${bundle}: MISSING from ${vueDir}`)
    }
  }

  // Compare bundle sizes - Vue should be in the same ballpark
  subheader('Size comparison:')
  for (const bundle of expectedBundles) {
    const preactFile = path.join(preactDir, bundle)
    const vueFile = path.join(vueDir, bundle)
    if (!fs.existsSync(preactFile) || !fs.existsSync(vueFile)) continue

    const preactSize = fs.statSync(preactFile).size
    const vueSize = fs.statSync(vueFile).size
    const ratio = vueSize / preactSize

    if (ratio > 3) {
      warn(`${bundle}: Vue is ${ratio.toFixed(1)}x larger than Preact (${(vueSize / 1024).toFixed(0)} vs ${(preactSize / 1024).toFixed(0)} KB)`)
    } else if (ratio < 0.2) {
      error(`${bundle}: Vue is suspiciously small (${(vueSize / 1024).toFixed(0)} KB) — may be incomplete`)
    } else {
      pass(`${bundle}: size ratio ${ratio.toFixed(1)}x (Vue ${(vueSize / 1024).toFixed(0)} KB / Preact ${(preactSize / 1024).toFixed(0)} KB)`)
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 12. Hook / Composable Return Shape Comparison
// ═══════════════════════════════════════════════════════════════════════════
function extractReturnKeys(content: string, _hookName: string): Set<string> {
  const keys = new Set<string>()

  // Find the return statement that returns an object literal
  // Pattern: return { key1, key2, key3: value }
  const returnRe = new RegExp(`return\\s*\\{([^}]+)\\}`, 'g')
  let m: RegExpExecArray | null
  while ((m = returnRe.exec(content)) !== null) {
    const body = m[1]
    // Extract keys: "key," or "key:" or "key }" patterns
    const keyRe = /\b(\w+)\s*[,:}]/g
    let km: RegExpExecArray | null
    while ((km = keyRe.exec(body)) !== null) {
      const key = km[1]
      // Skip common false positives
      if (!['return', 'const', 'let', 'var', 'new', 'true', 'false', 'null', 'undefined'].includes(key)) {
        keys.add(key)
      }
    }
  }

  return keys
}

function checkHookShapes() {
  header('12. Hook/Composable Return Shape')

  const hookPairs: { name: string; reactFile: string; vueFile: string }[] = [
    {
      name: 'useServerStats',
      reactFile: path.join(REACT_HOOKS, 'useServerStats.ts'),
      vueFile: path.join(VUE_COMPOSABLES, 'useServerStats.ts'),
    },
    {
      name: 'useDebugData',
      reactFile: path.join(REACT_HOOKS, 'useDebugData.ts'),
      vueFile: path.join(VUE_COMPOSABLES, 'useDebugData.ts'),
    },
    {
      name: 'useDashboardData',
      reactFile: path.join(REACT_HOOKS, 'useDashboardData.ts'),
      vueFile: path.join(VUE_COMPOSABLES, 'useDashboardData.ts'),
    },
    {
      name: 'useFeatures',
      reactFile: path.join(REACT_HOOKS, 'useFeatures.ts'),
      vueFile: path.join(VUE_COMPOSABLES, 'useFeatures.ts'),
    },
    {
      name: 'useTheme',
      reactFile: path.join(REACT_HOOKS, 'useTheme.ts'),
      vueFile: path.join(VUE_COMPOSABLES, 'useTheme.ts'),
    },
  ]

  // Known naming aliases between React and Vue
  const returnAliases: Record<string, string> = {
    isLoading: 'loading',
    clearData: 'clear',
    unauthorized: 'isUnauthorized',
    getHistory: 'history', // React has getHistory, Vue makes history reactive
    meta: 'pagination', // React returns meta, Vue returns pagination
    cacheForTab: '', // React-only
    getApi: '', // React-only escape hatch
  }

  for (const pair of hookPairs) {
    if (!fs.existsSync(pair.reactFile) || !fs.existsSync(pair.vueFile)) {
      error(`${pair.name}: missing file (React: ${fs.existsSync(pair.reactFile)}, Vue: ${fs.existsSync(pair.vueFile)})`)
      continue
    }

    const reactContent = fs.readFileSync(pair.reactFile, 'utf-8')
    const vueContent = fs.readFileSync(pair.vueFile, 'utf-8')

    const reactKeys = extractReturnKeys(reactContent, pair.name)
    const vueKeys = extractReturnKeys(vueContent, pair.name)

    if (reactKeys.size === 0 || vueKeys.size === 0) {
      warn(`${pair.name}: could not extract return keys (React: ${reactKeys.size}, Vue: ${vueKeys.size})`)
      continue
    }

    const missingInVue: string[] = []
    for (const key of reactKeys) {
      // Check direct match or known alias
      if (vueKeys.has(key)) continue
      const alias = returnAliases[key]
      if (alias !== undefined) {
        if (alias === '') continue // React-only, skip
        if (vueKeys.has(alias)) continue
      }
      missingInVue.push(key)
    }

    const extraInVue = [...vueKeys].filter((k) => {
      if (reactKeys.has(k)) return false
      // Check reverse aliases
      for (const [rk, vk] of Object.entries(returnAliases)) {
        if (vk === k && reactKeys.has(rk)) return false
      }
      return true
    })

    if (missingInVue.length === 0) {
      pass(`${pair.name}: all React return keys present in Vue (React: ${reactKeys.size}, Vue: ${vueKeys.size})`)
    } else {
      for (const key of missingInVue) {
        warn(`${pair.name}: return key "${key}" in React but not Vue`)
      }
    }

    if (extraInVue.length > 0) {
      info(`${pair.name}: Vue-only return keys: ${extraInVue.join(', ')}`)
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════════════════
function main() {
  console.log()
  console.log(`${BOLD}${BG_GREEN}${WHITE} Frontend Comparison: React (source of truth) vs Vue ${RESET}`)
  console.log(`${DIM}Root: ${ROOT}${RESET}`)
  console.log(`${DIM}React missing in Vue = ERROR | Vue extra = WARNING${RESET}`)

  // 1. Component mapping
  const matched = checkComponentMapping()

  // 2. CSS class comparison
  checkCssClasses(matched)

  // 3. API endpoint comparison
  checkApiEndpoints()

  // 4. Provide/Inject audit
  checkProvideInject()

  // 5. Props comparison
  checkProps(matched)

  // 6. Function vs Ref check
  checkFunctionVsRef()

  // 7. Formatter usage parity
  checkFormatterUsage(matched)

  // 8. Core import parity
  checkCoreImports(matched)

  // 9. Loading/Error/Empty state parity
  checkStatePatterns(matched)

  // 10. Event handler parity
  checkEventHandlers(matched)

  // 11. Build output verification
  checkBuildOutput()

  // 12. Hook/Composable return shapes
  checkHookShapes()

  // Summary
  console.log()
  console.log(`${BOLD}${BG_BLUE}${WHITE} Summary ${RESET}`)
  console.log(`${DIM}${'─'.repeat(60)}${RESET}`)
  console.log(`  ${GREEN}${BOLD}Passes:${RESET}   ${passes}`)
  console.log(`  ${YELLOW}${BOLD}Warnings:${RESET} ${warnings}`)
  console.log(`  ${RED}${BOLD}Errors:${RESET}   ${errors}`)
  console.log()

  if (errors > 0) {
    console.log(`  ${BG_RED}${WHITE}${BOLD} ${errors} error(s) found — likely bugs! ${RESET}`)
  } else if (warnings > 0) {
    console.log(`  ${BG_YELLOW}${WHITE}${BOLD} ${warnings} warning(s) — minor/intentional differences ${RESET}`)
  } else {
    console.log(`  ${BG_GREEN}${WHITE}${BOLD} All checks passed! ${RESET}`)
  }
  console.log()

  process.exit(errors > 0 ? 1 : 0)
}

main()
