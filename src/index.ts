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

type Parent = Root | Effect | Computed
let PARENT: Parent | undefined

export const getParent = () => PARENT
export function runWithParent<T>(owner: Parent | undefined, callback: () => T) {
  let previous = PARENT
  PARENT = owner
  try {
    callback()
  } finally {
    PARENT = previous
  }
}

/**********************************************************************************/
/*                                                                                */
/*                                   On Cleanup                                   */
/*                                                                                */
/**********************************************************************************/

export const onCleanup = (callback: () => void) => PARENT?.onCleanupHandlers.add(callback)

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
    this.parent = PARENT
    PARENT?.children.add(this)
  }

  addObserver() {
    if (!shouldTrack) return
    if (!PARENT) return
    this.observers.add(PARENT)
    PARENT.dependencies.add(this)
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
      if (observer instanceof Effect) {
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
    if (this instanceof Snigal) {
      this.update()
      return
    }

    let shouldUpdate = false

    this.dependencies.forEach((dependency) => {
      if (dependency.flag === 'clean') return
      dependency.resolve()
      if (dependency.flag === 'dirty') {
        shouldUpdate = true
      }
    })

    // if none of the dependencies has changed
    //    do not update and return false
    if (!shouldUpdate) {
      this.flag = 'clean'
      return
    }
    this.update()
  }
  abstract update(): void
}

/**********************************************************************************/
/*                                                                                */
/*                                     Snigal                                     */
/*                                                                                */
/**********************************************************************************/

export class Snigal<T> extends ReactiveNode {
  needsReset = false
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
      this.needsReset = true
      this.flag = 'dirty'
      this.markObservers()
    }
    return this.value
  }
  update() {
    const shouldUpdate = this.flag === 'dirty'
    if (this.needsReset) {
      this.needsReset = false
      queueMicrotask(this.reset.bind(this))
    }
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

  constructor(public callback: () => T) {
    super()
    this.flag = 'update'
  }

  get() {
    if (this.flag === 'update') this.update()
    this.addObserver()
    return this.value
  }
  reset() {
    super.reset()
  }
  update() {
    if (this.flag !== 'update') return
    let previous = PARENT
    try {
      PARENT = this
      let previousValue = this.value
      this.cleanupDependencies()
      this.cleanup()
      this.value = this.callback()
      this.flag = previousValue !== this.value ? 'dirty' : 'clean'
    } finally {
      PARENT = previous
      queueMicrotask(this.reset.bind(this))
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
    if (!PARENT) {
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
    let previous = PARENT
    try {
      PARENT = this
      this.cleanupDependencies()
      this.cleanupObservers()
      this.cleanup()
      this.callback()
    } finally {
      PARENT = previous
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

export class Root extends ReactiveNode {
  constructor(callback: () => void) {
    super()
    let previous = PARENT
    try {
      PARENT = this
      callback()
    } finally {
      PARENT = previous
    }
  }

  update(): boolean {
    throw 'Root should not update'
  }
}
