import React from 'react';
import {shallow} from 'enzyme';
import VM from 'scratch-vm';

import {Timeline} from '../../../src/components/timeline/timeline';

describe('Timeline keyboard controls', () => {
    let component;
    let instance;
    let manager;
    const body = {};

    const makeEvent = overrides => Object.assign({
        altKey: false,
        code: '',
        ctrlKey: false,
        key: '',
        keyCode: 0,
        metaKey: false,
        preventDefault: jest.fn(),
        repeat: false,
        shiftKey: false,
        target: body
    }, overrides);

    beforeAll(() => {
        global.document = {body};
    });

    afterAll(() => {
        delete global.document;
    });

    beforeEach(() => {
        component = shallow(
            <Timeline
                customStageSize={{height: 360, width: 480}}
                framerate={30}
                vm={Object.create(VM.prototype)}
            />,
            {disableLifecycleMethods: true}
        );
        instance = component.instance();
        manager = {
            addTimelineKeyframe: jest.fn(),
            pauseTimeline: jest.fn(),
            playTimeline: jest.fn(),
            removeTimelineKeyframe: jest.fn(),
            renderAndExportTimeline: jest.fn(() => Promise.resolve()),
            seekTimeline: jest.fn(),
            updateTimelineSettings: jest.fn()
        };
        instance.manager = manager;
    });

    test('space toggles playback while the timeline is focused', () => {
        const scrubber = {tagName: 'DIV'};
        instance.timelineElement = {contains: target => target === scrubber};
        instance.scrubberElement = scrubber;
        const event = makeEvent({key: ' ', code: 'Space', target: scrubber});

        instance.handleKeyDown(event);

        expect(event.preventDefault).toHaveBeenCalled();
        expect(manager.playTimeline).toHaveBeenCalled();
    });

    test('provides a timeline header space for add-on controls', () => {
        expect(component.find('[data-movie-timeline-addons]')).toHaveLength(1);
    });

    test('keeps playback controls in the header above the timeline track', () => {
        const playbackControls = component.find('[data-movie-timeline-playback]');
        const renderedMarkup = component.debug();
        const playbackIndex = renderedMarkup.indexOf('data-movie-timeline-playback');
        const timelineTrackIndex = renderedMarkup.indexOf('aria-label="Current timeline position"');

        expect(playbackControls).toHaveLength(1);
        expect(playbackIndex).toBeGreaterThan(-1);
        expect(timelineTrackIndex).toBeGreaterThan(-1);
        expect(playbackIndex).toBeLessThan(timelineTrackIndex);
    });

    test('space does not toggle playback while editing text', () => {
        const event = makeEvent({
            key: ' ',
            code: 'Space',
            target: {tagName: 'INPUT', type: 'text'}
        });

        instance.handleKeyDown(event);

        expect(event.preventDefault).not.toHaveBeenCalled();
        expect(manager.playTimeline).not.toHaveBeenCalled();
    });

    test('right arrow advances one frame when no control is focused', () => {
        const event = makeEvent({key: 'ArrowRight', keyCode: 39});

        instance.handleKeyDown(event);

        expect(event.preventDefault).toHaveBeenCalled();
        expect(manager.seekTimeline).toHaveBeenCalledWith(1 / 30);
    });

    test('left arrow moves back one frame when the timeline is focused', () => {
        const timelineControl = {tagName: 'DIV'};
        instance.timelineElement = {contains: target => target === timelineControl};
        instance.scrubberElement = timelineControl;
        component.setState({
            timeline: Object.assign({}, instance.state.timeline, {currentTime: 1})
        });
        const event = makeEvent({key: 'ArrowLeft', keyCode: 37, target: timelineControl});

        instance.handleKeyDown(event);

        expect(event.preventDefault).toHaveBeenCalled();
        expect(manager.seekTimeline).toHaveBeenCalledWith(29 / 30);
    });

    test('arrow keys do not move the timeline while editing text or focusing another control', () => {
        const textEvent = makeEvent({
            key: 'ArrowRight',
            keyCode: 39,
            target: {tagName: 'TEXTAREA'}
        });
        const otherButtonEvent = makeEvent({
            key: 'ArrowLeft',
            keyCode: 37,
            target: {tagName: 'BUTTON'}
        });

        instance.handleKeyDown(textEvent);
        instance.handleKeyDown(otherButtonEvent);

        expect(manager.seekTimeline).not.toHaveBeenCalled();
    });

    test('up and down arrows step the focused timeline by one frame', () => {
        const timelineControl = {tagName: 'DIV'};
        instance.timelineElement = {contains: target => target === timelineControl};
        instance.scrubberElement = timelineControl;
        component.setState({
            timeline: Object.assign({}, instance.state.timeline, {currentTime: 1})
        });

        instance.handleKeyDown(makeEvent({key: 'ArrowUp', keyCode: 38, target: timelineControl}));
        instance.handleKeyDown(makeEvent({key: 'ArrowDown', keyCode: 40, target: timelineControl}));

        expect(manager.seekTimeline).toHaveBeenNthCalledWith(1, 31 / 30);
        expect(manager.seekTimeline).toHaveBeenNthCalledWith(2, 29 / 30);
    });

    test('home and end seek to the timeline boundaries', () => {
        const timelineControl = {tagName: 'DIV'};
        instance.timelineElement = {contains: target => target === timelineControl};
        instance.scrubberElement = timelineControl;

        instance.handleKeyDown(makeEvent({key: 'Home', keyCode: 36, target: timelineControl}));
        instance.handleKeyDown(makeEvent({key: 'End', keyCode: 35, target: timelineControl}));

        expect(manager.seekTimeline).toHaveBeenNthCalledWith(1, 0);
        expect(manager.seekTimeline).toHaveBeenNthCalledWith(2, 10);
    });

    test('volume slider keeps its native keyboard controls inside the timeline', () => {
        const volumeSlider = {tagName: 'INPUT', type: 'range'};
        instance.timelineElement = {contains: target => target === volumeSlider};
        instance.scrubberElement = {tagName: 'INPUT', type: 'range'};
        const event = makeEvent({key: 'ArrowRight', keyCode: 39, target: volumeSlider});

        instance.handleKeyDown(event);

        expect(event.preventDefault).not.toHaveBeenCalled();
        expect(manager.seekTimeline).not.toHaveBeenCalled();
    });

    test('renders a scrollable ruler instead of a range input', () => {
        expect(component.find('[role="slider"]')).toHaveLength(1);
        expect(component.find('input[type="range"]')).toHaveLength(0);
        expect(component.find('[aria-label="Timeline zoom"]')).toHaveLength(1);
    });

    test('does not render code ranges or determinism diagnostics', () => {
        expect(component.find('[aria-label="Code-derived active ranges"]')).toHaveLength(0);
        expect(component.find('[aria-label="Frame determinism warnings"]')).toHaveLength(0);
    });

    test('adds, selects, seeks to, and deletes time-ordered keyframes', () => {
        component.setState({
            timeline: Object.assign({}, instance.state.timeline, {
                currentTime: 4,
                keyframes: [1, 4, 7]
            })
        });

        instance.handleAddKeyframe();
        expect(manager.addTimelineKeyframe).toHaveBeenCalledWith(4);

        const marker = component.find('button[aria-label="Keyframe 2, 00:04.00"]');
        marker.simulate('click', {
            currentTarget: {value: '4'},
            stopPropagation: jest.fn()
        });
        expect(manager.seekTimeline).toHaveBeenCalledWith(4);
        expect(instance.state.selectedKeyframeTime).toBe(4);

        instance.handleDeleteKeyframe();
        expect(manager.removeTimelineKeyframe).toHaveBeenCalledWith(2);
        expect(instance.state.selectedKeyframeTime).toBeNull();
    });

    test('does not treat an unselected keyframe at time zero as selected', () => {
        component.setState({
            selectedKeyframeTime: null,
            timeline: Object.assign({}, instance.state.timeline, {keyframes: [0, 2]})
        });

        expect(component.find('button[aria-label="Keyframe 1, 00:00.00"]').prop('aria-pressed')).toBe(false);
        expect(component.find('button[title="Delete the selected keyframe"]').prop('disabled')).toBe(true);
    });

    test('keeps fractional ruler labels accurate at high zoom', () => {
        component.setState({pixelsPerSecond: 320, viewportWidth: 640});

        expect(component.text()).toContain('0.5s');
        expect(component.text()).toContain('1.5s');
    });

    test('clicking the ruler seeks using its scrolled and zoomed position', () => {
        instance.viewportElement = {
            getBoundingClientRect: () => ({left: 100}),
            scrollLeft: 144
        };
        instance.seekFromClientX(172);

        expect(manager.seekTimeline).toHaveBeenCalledWith(3);
    });

    test('vertical wheel input scrolls time horizontally', () => {
        instance.viewportElement = {
            clientHeight: 120,
            scrollHeight: 120,
            scrollLeft: 144
        };
        const event = {
            ctrlKey: false,
            deltaX: 0,
            deltaY: 40,
            metaKey: false,
            preventDefault: jest.fn()
        };

        instance.handleTimelineWheel(event);

        expect(event.preventDefault).toHaveBeenCalled();
        expect(instance.viewportElement.scrollLeft).toBe(184);
    });

    test('zoom keeps the time under the viewport center anchored', () => {
        instance.viewportElement = {
            getBoundingClientRect: () => ({left: 0, width: 400}),
            scrollLeft: 160
        };

        instance.handleZoomIn();

        expect(instance.state.pixelsPerSecond).toBe(90);
        expect(instance.viewportElement.scrollLeft).toBe(250);
    });

    test('zooms out to 5 percent for long timelines', () => {
        instance.viewportElement = {
            getBoundingClientRect: () => ({left: 0, width: 480}),
            scrollLeft: 0
        };
        component.setState({
            timeline: Object.assign({}, instance.state.timeline, {duration: 200})
        });

        for (let attempt = 0; attempt < 20; attempt++) instance.handleZoomOut();

        expect(instance.state.pixelsPerSecond).toBe(3.6);
        expect(component.text()).toContain('5%');
        expect(component.find('button[aria-label="Zoom out timeline"]').prop('disabled')).toBe(true);
    });

    test('Export MP4 applies settings and renders fresh frames before exporting', async () => {
        component.setState({
            draft: {
                duration: '12',
                framerate: '24',
                height: '1080',
                width: '1920'
            },
            settingsOpen: true
        });

        await instance.handleExport();

        expect(manager.updateTimelineSettings).toHaveBeenCalledWith({
            duration: 12,
            framerate: 24,
            height: 1080,
            width: 1920
        });
        expect(manager.renderAndExportTimeline).toHaveBeenCalledTimes(1);
        expect(instance.state.exporting).toBe(false);
    });

    test('Export MP4 is available without pre-rendered frames', () => {
        component.setState({
            draft: Object.assign({}, instance.state.timeline),
            settingsOpen: true
        });

        const exportButton = component.find('button').filterWhere(button =>
            button.text() === 'Export MP4'
        );

        expect(exportButton).toHaveLength(1);
        expect(exportButton.prop('disabled')).toBe(false);
    });

    test('rendering settings omit standalone frame actions', () => {
        component.setState({
            draft: Object.assign({}, instance.state.timeline),
            settingsOpen: true
        });

        expect(component.text()).not.toContain('Clear frames');
        expect(component.text()).not.toContain('Render frames');
    });

    test('rendering settings do not show the legacy Audio selector', () => {
        component.setState({
            draft: Object.assign({}, instance.state.timeline),
            settingsOpen: true
        });

        expect(component.text()).not.toContain('Audio');
        expect(component.find('select')).toHaveLength(0);
    });

    test('rendering settings preserve output resolution independently from the stage size', () => {
        component.setState({
            timeline: Object.assign({}, instance.state.timeline, {
                height: 1080,
                width: 1920
            })
        });

        instance.handleToggleSettings();

        expect(instance.state.draft.height).toBe(1080);
        expect(instance.state.draft.width).toBe(1920);
        expect(component.text()).toContain('The stage stays at 480×360');
    });
});
