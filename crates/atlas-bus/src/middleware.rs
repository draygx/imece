//! Ordered middleware chains for the agent subsystem.
//!
//! - Outbound: observe every emitted agent event (`E`). Used by the host for
//!   the window broadcast, telemetry, and memory-ingest — each a small,
//!   testable unit instead of one monolithic sink body.
//! - Inbound: mutate an outgoing prompt context (`C`) before it reaches the
//!   agent. Used for automatic context / skill / bootstrap injection so it
//!   applies uniformly to the native and every ACP agent.

use std::sync::Arc;

use async_trait::async_trait;

/// Observes an emitted event. Implementations must be cheap / non-blocking on
/// the calling thread — offload heavy work (disk, network) to a spawned task.
pub trait OutboundMiddleware<E>: Send + Sync {
    fn on_event(&self, event: &E);
}

/// Mutates an outgoing prompt context in place before dispatch. Runs in order;
/// an implementation that can't contribute (timeout, disabled) should leave the
/// context unchanged rather than error.
// Newer clippy flags the `#[must_use]` that `#[async_trait]` puts on the boxed
// future it returns (`double_must_use`); the attribute is the macro's, not ours.
#[allow(clippy::double_must_use)]
#[async_trait]
pub trait InboundMiddleware<C: Send>: Send + Sync {
    async fn on_prompt(&self, cx: &mut C);
}

/// An ordered chain of outbound middleware. `run` invokes each in registration
/// order for a single event.
pub struct OutboundPipeline<E> {
    stages: Vec<Arc<dyn OutboundMiddleware<E>>>,
}

impl<E> OutboundPipeline<E> {
    pub fn new() -> Self {
        Self { stages: Vec::new() }
    }

    /// Append a stage (builder style).
    pub fn with(mut self, stage: Arc<dyn OutboundMiddleware<E>>) -> Self {
        self.stages.push(stage);
        self
    }

    /// Append a stage in place.
    pub fn push(&mut self, stage: Arc<dyn OutboundMiddleware<E>>) {
        self.stages.push(stage);
    }

    /// Run every stage for `event`, in order.
    pub fn run(&self, event: &E) {
        for stage in &self.stages {
            stage.on_event(event);
        }
    }

    pub fn is_empty(&self) -> bool {
        self.stages.is_empty()
    }
}

impl<E> Default for OutboundPipeline<E> {
    fn default() -> Self {
        Self::new()
    }
}

/// An ordered chain of inbound middleware. `run` threads the context through
/// each stage in order.
pub struct InboundPipeline<C: Send> {
    stages: Vec<Arc<dyn InboundMiddleware<C>>>,
}

impl<C: Send> InboundPipeline<C> {
    pub fn new() -> Self {
        Self { stages: Vec::new() }
    }

    pub fn with(mut self, stage: Arc<dyn InboundMiddleware<C>>) -> Self {
        self.stages.push(stage);
        self
    }

    pub fn push(&mut self, stage: Arc<dyn InboundMiddleware<C>>) {
        self.stages.push(stage);
    }

    /// Thread `cx` through every stage, in order.
    pub async fn run(&self, cx: &mut C) {
        for stage in &self.stages {
            stage.on_prompt(cx).await;
        }
    }

    pub fn is_empty(&self) -> bool {
        self.stages.is_empty()
    }
}

impl<C: Send> Default for InboundPipeline<C> {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    struct Recorder {
        tag: &'static str,
        log: Arc<Mutex<Vec<String>>>,
    }
    impl OutboundMiddleware<u32> for Recorder {
        fn on_event(&self, event: &u32) {
            self.log.lock().unwrap().push(format!("{}:{event}", self.tag));
        }
    }

    #[test]
    fn outbound_runs_in_order() {
        let log = Arc::new(Mutex::new(Vec::new()));
        let pipe = OutboundPipeline::new()
            .with(Arc::new(Recorder { tag: "a", log: log.clone() }))
            .with(Arc::new(Recorder { tag: "b", log: log.clone() }));
        pipe.run(&5);
        assert_eq!(*log.lock().unwrap(), vec!["a:5", "b:5"]);
    }

    struct Append(&'static str);
    #[async_trait]
    impl InboundMiddleware<String> for Append {
        async fn on_prompt(&self, cx: &mut String) {
            cx.push_str(self.0);
        }
    }

    /// Why a consumer that must not miss an event belongs here rather than on
    /// the broadcast bus.
    ///
    /// The bus is a ring buffer: `publish` never blocks, so a subscriber that
    /// falls further behind than the capacity *loses events* — counted and
    /// logged, but gone. That is the correct trade for the UI fan-out, where a
    /// dropped frame is invisible. It is the wrong trade for session capture,
    /// where a dropped event is a turn missing from the permanent record.
    ///
    /// The pipeline runs synchronously on the emit thread and therefore cannot
    /// lag by construction. This test pins the contrast so a future refactor
    /// that "simplifies" capture onto a bus subscription fails here first.
    #[tokio::test]
    async fn the_pipeline_sees_every_event_where_a_lagging_subscriber_loses_some() {
        use crate::EventBus;

        const CAPACITY: usize = 4;
        const BURST: u32 = 64;

        let seen = Arc::new(Mutex::new(Vec::new()));
        let pipe = OutboundPipeline::new().with(Arc::new(Recorder {
            tag: "capture",
            log: seen.clone(),
        }));

        let bus: EventBus<u32> = EventBus::with_capacity(CAPACITY);
        let mut lagging = bus.subscribe_counted("bare-subscription");

        for event in 0..BURST {
            bus.publish(event);
            pipe.run(&event);
        }

        assert_eq!(
            seen.lock().unwrap().len(),
            BURST as usize,
            "the pipeline must see every event"
        );

        drop(bus);
        let mut received = 0;
        while lagging.recv().await.is_some() {
            received += 1;
        }
        assert!(
            received < BURST as usize && lagging.dropped() > 0,
            "the bare subscription was expected to lose events under this burst \
             (received {received}, dropped {})",
            lagging.dropped()
        );
    }

    #[tokio::test]
    async fn inbound_threads_context_in_order() {
        let pipe = InboundPipeline::new()
            .with(Arc::new(Append("a")))
            .with(Arc::new(Append("b")));
        let mut cx = String::from("start:");
        pipe.run(&mut cx).await;
        assert_eq!(cx, "start:ab");
    }
}
