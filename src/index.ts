/**
 * Snigal is an interpretation of @modderme's signal-library `reactively` aka `solid 2.0`
 * @article https://github.com/modderme123/reactively
 * @article https://dev.to/modderme123/super-charging-fine-grained-reactive-performance-47ph
 * @article https://github.com/solidjs/signals
 */

/**********************************************************************************/
/*                                                                                */
/*                          Get Parent / Run With Parent                          */
/*                                                                                */
/**********************************************************************************/

let CURRENT_NODE: ReactiveNode | undefined

export const getParent = () => CURRENT_NODE
export function runWithParent<T>(owner: ReactiveNode | undefined, callback: () => T) {
  let previous = CURRENT_NODE
  CURRENT_NODE = owner
  try {
    callback()
  } finally {
    CURRENT_NODE = previous
  }
}

/**********************************************************************************/
/*                                                                                */
/*                                   On Cleanup                                   */
/*                                                                                */
/**********************************************************************************/

export const onCleanup = (callback: () => void) => CURRENT_NODE?.onCleanupHandlers.add(callback)

/**********************************************************************************/
/*                                                                                */
/*                                     Untrack                                    */
/*                                                                                */
/**********************************************************************************/

let shouldTrack = true

export function untrack<T>(callback: () => T) {
  try {
    shouldTrack = false
    return callback()
  } finally {
    shouldTrack = true
  }
}

/**********************************************************************************/
/*                                                                                */
/*                                   Scheduling                                   */
/*                                                                                */
/**********************************************************************************/

const EFFECT_QUEUE: Effect[] = []

let isPending = false

const flushQueue = () => {
  try {
    EFFECT_QUEUE.forEach((effect) => effect.resolve())
  } finally {
    EFFECT_QUEUE.length = 0
    isPending = false
  }
}

const scheduleFlush = () => {
  if (isPending) return
  isPending = true
  queueMicrotask(flushQueue)
}

/**********************************************************************************/
/*                                                                                */
/*                                  Reactive Node                                 */
/*                                                                                */
/**********************************************************************************/

abstract class ReactiveNode {
  children = new Set<ReactiveNode>()
  isDisposed = false
  onCleanupHandlers = new Set<() => void>()
  dependencies = new Set<ReactiveNode>()
  flag: 'dirty' | 'update' | 'clean' = 'clean'
  observers = new Set<ReactiveNode>()
  parent: ReactiveNode | undefined

  constructor() {
    this.parent = CURRENT_NODE
    CURRENT_NODE?.children.add(this)
  }

  addObserver() {
    if (!shouldTrack) return
    if (!CURRENT_NODE) return
    this.observers.add(CURRENT_NODE)
    CURRENT_NODE.dependencies.add(this)
  }
  cleanup() {
    this.onCleanupHandlers.forEach((cleanup) => cleanup())
    this.onCleanupHandlers.clear()
    this.children.forEach((child) => child.dispose())
    this.children.clear()
  }
  cleanupDependencies() {
    this.dependencies.forEach((dependency) => {
      dependency.observers.delete(this)
    })
    this.dependencies.clear()
  }
  cleanupObservers() {
    this.observers.forEach((observer) => {
      observer.dependencies.delete(this)
    })
    this.observers.clear()
  }
  dispose() {
    this.isDisposed = true
    this.cleanupDependencies()
    this.cleanupObservers()
    this.cleanup()
  }
  markObservers() {
    this.observers.forEach((observer) => {
      if (observer instanceof Snigal) return
      if (observer.flag !== 'clean') return
      observer.flag = 'update'
      if (observer instanceof Computed) {
        observer.dependenciesAreStale = true
      } else if (observer instanceof Effect) {
        EFFECT_QUEUE.push(observer)
        scheduleFlush()
      }
      observer.markObservers()
    })
  }
  reset() {
    this.flag = 'clean'
  }
  resolve() {
    if (this instanceof Snigal) return this.update()

    let shouldUpdate = false

    this.dependencies.forEach((dependency) => {
      if (dependency.flag === 'clean') return
      if (dependency.resolve()) shouldUpdate = true
    })

    // if none of the dependencies has changed
    //    do not update and return false
    if (!shouldUpdate) return false

    return this.update()
  }
  abstract update(): boolean
}

/**********************************************************************************/
/*                                                                                */
/*                                     Snigal                                     */
/*                                                                                */
/**********************************************************************************/

export class Snigal<T> extends ReactiveNode {
  constructor(public value: T) {
    super()
  }

  get() {
    this.addObserver()
    return this.value
  }
  set(value: T) {
    const shouldUpdate = value !== this.value
    this.value = value
    if (shouldUpdate) {
      this.flag = 'dirty'
      this.markObservers()
    }
    return this.value
  }
  update() {
    const shouldUpdate = this.flag === 'dirty'
    queueMicrotask(this.reset.bind(this))
    return shouldUpdate
  }
}

/**********************************************************************************/
/*                                                                                */
/*                                    Computed                                    */
/*                                                                                */
/**********************************************************************************/

export class Computed<T = any> extends ReactiveNode {
  //@ts-ignore
  private value: T
  valueHasChanged = false
  dependenciesAreStale = true

  constructor(public callback: () => T) {
    super()
  }

  get() {
    if (this.dependenciesAreStale) this.update()
    this.addObserver()
    return this.value
  }
  reset() {
    super.reset()
    this.valueHasChanged = false
  }
  update() {
    if (!this.dependenciesAreStale) {
      return this.valueHasChanged
    }
    let previous = CURRENT_NODE
    try {
      CURRENT_NODE = this
      let previousValue = this.value
      this.cleanupDependencies()
      this.cleanup()
      this.value = this.callback()
      this.dependenciesAreStale = false
      this.valueHasChanged = previousValue !== this.value
    } finally {
      CURRENT_NODE = previous
      queueMicrotask(this.reset.bind(this))
      return this.valueHasChanged
    }
  }
}

/**********************************************************************************/
/*                                                                                */
/*                                     Effect                                     */
/*                                                                                */
/**********************************************************************************/

export class Effect extends ReactiveNode {
  constructor(public callback: () => void, immediate?: boolean) {
    if (!CURRENT_NODE) {
      console.warn('effects outside of root will not be automatically disposed')
    }
    super()
    if (immediate) {
      this.update()
    } else {
      queueMicrotask(this.update.bind(this))
    }
  }

  update() {
    if (this.isDisposed) return false
    if (this.parent && this.parent?.flag !== 'clean') return false
    let previous = CURRENT_NODE
    try {
      CURRENT_NODE = this
      this.cleanupDependencies()
      this.cleanupObservers()
      this.cleanup()
      this.callback()
    } finally {
      CURRENT_NODE = previous
      this.flag = 'clean'
      return true
    }
  }
}

/**********************************************************************************/
/*                                                                                */
/*                                      Root                                      */
/*                                                                                */
/**********************************************************************************/

export class Root<T> extends ReactiveNode {
  constructor(callback: () => T) {
    super()
    let previous = CURRENT_NODE
    try {
      CURRENT_NODE = this
      callback()
    } catch (e) {
      throw e
    } finally {
      CURRENT_NODE = previous
    }
  }

  update() {
    return true
  }
}
