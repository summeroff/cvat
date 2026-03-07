// Copyright (C) CVAT.ai Corporation
//
// SPDX-License-Identifier: MIT

import './styles.scss';

import React, {
    useEffect, useState,
} from 'react';
import { useSelector } from 'react-redux';
import { Link } from 'react-router-dom';
import dayjs, { Dayjs } from 'dayjs';
import { Col, Row } from 'antd/lib/grid';
import Card from 'antd/lib/card';
import Text from 'antd/lib/typography/Text';
import Icon from '@ant-design/icons';
import {
    BlockOutlined,
    BorderOutlined,
    LoadingOutlined, MoreOutlined, QuestionCircleOutlined,
} from '@ant-design/icons/lib/icons';
import { DurationIcon, FramesIcon } from 'icons';
import {
    Job, JobStage, JobState, JobType, Task, User,
} from 'cvat-core-wrapper';
import { useIsMounted, useContextMenuClick } from 'utils/hooks';
import UserSelector from 'components/task-page/user-selector';
import CVATTooltip from 'components/common/cvat-tooltip';
import { CombinedState } from 'reducers';
import CVATTag, { TagType } from 'components/common/cvat-tag';
import JobActionsComponent from 'components/jobs-page/actions-menu';
import { JobStageSelector, JobStateSelector } from './job-selectors';

function formatDate(value: Dayjs): string {
    return value.format('MMM Do YYYY HH:mm');
}

export interface LabelObjects {
    [key: string]: {
        objects: number;
        attributes: number;
        true_attributes: number;
        label_name?: string;
        true_attributes_sums: { [id: string]: { count: number; name: string } };
    };
}

export interface JobData {
    jobId: number;
    objectsCount: number;
    attributesCount: number;
    attributesPerLabel: LabelObjects;
}

function updateLabelNameInObjects(jobInstance: Job, objects: LabelObjects): void {
    for (const label of jobInstance.labels) {
        const id: string = label.id.toString();
        if (objects[id]) {
            objects[id].label_name = label.name;
        } else {
            objects[id] = {
                objects: 0,
                attributes: 0,
                true_attributes: 0,
                label_name: label.name,
                true_attributes_sums: {},
            };
        }
        for (const attr of label.attributes) {
            if (attr.inputType === 'checkbox') {
                if (typeof objects[id].true_attributes_sums[attr.id] === 'object') {
                    objects[id].true_attributes_sums[attr.id].name = attr.name;
                } else {
                    objects[id].true_attributes_sums[attr.id] = { count: 0, name: attr.name };
                }
            } else {
                delete objects[id].true_attributes_sums[attr.id];
            }
        }
    }
}

function LabelingSummaryComponent({
    jobInstance,
    addObject,
}: Readonly<{
    jobInstance: Job;
    addObject?: (newData: JobData) => void;
}>): JSX.Element {
    const [summary, setSummary] = useState<Record<string, any> | null>(null);
    const [error, setError] = useState<any>(null);
    const isMounted = useIsMounted();

    useEffect(() => {
        setError(null);
        jobInstance
            .objects()
            .then((objects: any) => {
                if (isMounted()) {
                    setSummary({ objects });
                    updateLabelNameInObjects(jobInstance, objects.per_label);
                    if (addObject) {
                        const newData: JobData = {
                            jobId: jobInstance.id,
                            objectsCount: objects.objects,
                            attributesCount: objects.attributes,
                            attributesPerLabel: JSON.parse(JSON.stringify(objects.per_label)),
                        };
                        addObject(newData);
                    }
                }
            })
            .catch((_error: any) => {
                if (isMounted()) {
                    // eslint-disable-next-line
                    console.log(_error);
                    setError(_error);
                }
            });
    }, []);

    if (!summary) {
        if (error) {
            if (error.toString().includes('403')) {
                return <Text type='secondary'>No permissions</Text>;
            }
            return <Text type='secondary'>Error loading</Text>;
        }
        return (
            <>
                <Text type='secondary'>Loading... </Text>
                <LoadingOutlined />
            </>
        );
    }

    return (
        <Text type='secondary'>{summary.objects.objects} / {summary.objects.attributes}</Text>
    );
}

interface Props {
    job: Job;
    task: Task;
    onJobUpdate: (job: Job, fields: Parameters<Job['save']>[0]) => void;
    selected?: boolean;
    onClick?: (event?: React.MouseEvent) => void;
    jobDataArray?: JobData[];
    addObject?: (newData: JobData) => void;
    onApplyFilter?: (filter: string | null) => void;
}

function ReviewSummaryComponent({ jobInstance }: Readonly<{ jobInstance: Job }>): JSX.Element {
    const [summary, setSummary] = useState<Record<string, any> | null>(null);
    const [error, setError] = useState<any>(null);
    const isMounted = useIsMounted();

    useEffect(() => {
        setError(null);
        jobInstance
            .issues(jobInstance.id)
            .then((issues: any[]) => {
                if (isMounted()) {
                    setSummary({
                        issues_unsolved: issues.filter((issue) => !issue.resolved).length,
                        issues_resolved: issues.filter((issue) => issue.resolved).length,
                    });
                }
            })
            .catch((_error: any) => {
                if (isMounted()) {
                    // eslint-disable-next-line
                    console.log(_error);
                    setError(_error);
                }
            });
    }, []);

    if (!summary) {
        if (error) {
            if (error.toString().includes('403')) {
                return <p>You do not have permissions</p>;
            }

            return <p>Could not fetch, check console output</p>;
        }

        return (
            <>
                <p>Loading.. </p>
                <LoadingOutlined />
            </>
        );
    }

    return (
        <table className='cvat-review-summary-description'>
            <tbody>
                <tr>
                    <td>
                        <Text strong>Unsolved issues</Text>
                    </td>
                    <td>{summary.issues_unsolved}</td>
                </tr>
                <tr>
                    <td>
                        <Text strong>Resolved issues</Text>
                    </td>
                    <td>{summary.issues_resolved}</td>
                </tr>
            </tbody>
        </table>
    );
}

function JobItem(props: Readonly<Props>): JSX.Element {
    const {
        job, task, onJobUpdate, selected, onClick,
        jobDataArray, addObject, onApplyFilter,
    } = props;

    const deletes = useSelector((state: CombinedState) => state.jobs.activities.deletes);
    const deleted = job.id in deletes ? deletes[job.id] === true : false;
    const { itemRef, handleContextMenuClick, handleContextMenuCapture } = useContextMenuClick<HTMLDivElement>();

    const { stage, state } = job;
    const created = dayjs(job.createdDate);
    const updated = dayjs(job.updatedDate);
    const now = dayjs();

    const style = {};
    if (deleted) {
        (style as any).pointerEvents = 'none';
        (style as any).opacity = 0.5;
    }
    const frameCountPercent = ((job.frameCount / (task.size || 1)) * 100).toFixed(0);
    const frameCountPercentRepresentation = frameCountPercent === '0' ? '<1' : frameCountPercent;
    const jobName = `Job #${job.id}`;

    let tag = null;
    if (job.type === JobType.GROUND_TRUTH) {
        tag = (
            <Col offset={1}>
                <CVATTag type={TagType.GROUND_TRUTH} />
            </Col>
        );
    } else if (job.replicasCount > 0) {
        tag = (
            <Col offset={1}>
                <CVATTag type={TagType.PARENT} />
            </Col>
        );
    } else if (job.parentJobId !== null) {
        tag = (
            <Col offset={1}>
                <CVATTag type={TagType.REPLICA} />
            </Col>
        );
    }

    /* eslint-disable jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */
    const card = (
        <Card
            ref={itemRef}
            className={`cvat-job-item${selected ? ' cvat-item-selected' : ''}`}
            style={{ ...style }}
            data-row-id={job.id}
            onClick={onClick}
            onContextMenuCapture={handleContextMenuCapture}
        >
            <Row align='middle'>
                <Col span={6}>
                    <Row>
                        <Col>
                            <Link to={`/tasks/${job.taskId}/jobs/${job.id}`}>{jobName}</Link>
                        </Col>
                        {tag}
                        {job.type !== JobType.GROUND_TRUTH && (
                            <Col className='cvat-job-item-issues-summary-icon'>
                                <CVATTooltip title={<ReviewSummaryComponent jobInstance={job} />}>
                                    <QuestionCircleOutlined />
                                </CVATTooltip>
                            </Col>
                        )}
                    </Row>
                    <Row className='cvat-job-item-dates-info'>
                        <Col>
                            <Text>Created: </Text>
                            <Text type='secondary'>{`${formatDate(created)}`}</Text>
                        </Col>
                    </Row>
                    <Row>
                        <Col>
                            <Text>Updated: </Text>
                            <Text type='secondary'>{`${formatDate(updated)}`}</Text>
                        </Col>
                    </Row>
                </Col>
                <Col span={12}>
                    <Row className='cvat-job-item-selects' justify='space-between'>
                        <Col>
                            <Row>
                                <Col className='cvat-job-item-select'>
                                    <Row>
                                        <Text>Assignee:</Text>
                                    </Row>
                                    <UserSelector
                                        className='cvat-job-assignee-selector'
                                        value={job.assignee}
                                        onSelect={(user: User | null): void => {
                                            if (job?.assignee?.id === user?.id) return;
                                            onJobUpdate(job, { assignee: user });
                                        }}
                                    />
                                </Col>
                                <Col className='cvat-job-item-select'>
                                    <Row justify='space-between' align='middle'>
                                        <Col>
                                            <Text>Stage:</Text>
                                        </Col>
                                    </Row>
                                    <JobStageSelector
                                        value={stage}
                                        onSelect={(newValue: JobStage) => {
                                            onJobUpdate(job, { stage: newValue });
                                        }}
                                    />
                                </Col>
                                <Col className='cvat-job-item-select'>
                                    <Row justify='space-between' align='middle'>
                                        <Col>
                                            <Text>State:</Text>
                                        </Col>
                                    </Row>
                                    <JobStateSelector
                                        value={state}
                                        onSelect={(newValue: JobState) => {
                                            onJobUpdate(job, { state: newValue });
                                        }}
                                    />
                                </Col>
                            </Row>
                        </Col>
                    </Row>
                </Col>
                <Col span={5} offset={1}>
                    <Row className='cvat-job-item-details'>
                        <Col>
                            <Row>
                                <Col>
                                    <Icon component={DurationIcon} />
                                    <Text>Duration: </Text>
                                    <Text type='secondary'>
                                        {`${dayjs
                                            .duration(now.diff(created))
                                            .humanize()}`}
                                    </Text>
                                </Col>
                            </Row>
                            <Row>
                                <Col>
                                    <BorderOutlined />
                                    <Text>Frames: </Text>
                                    <Text type='secondary' className='cvat-job-item-frames'>
                                        {job.type !== JobType.GROUND_TRUTH ?
                                            `${job.frameCount} (${frameCountPercentRepresentation}%) [${job.startFrame}-${job.stopFrame}]` :
                                            `${job.frameCount} (${frameCountPercentRepresentation}%)`}
                                    </Text>
                                </Col>
                            </Row>
                            {jobDataArray && addObject && (
                                <Row>
                                    <Col>
                                        <BlockOutlined />
                                        <Text>Objects: </Text>
                                        <LabelingSummaryComponent
                                            jobInstance={job}
                                            addObject={addObject}
                                        />
                                    </Col>
                                </Row>
                            )}
                        </Col>
                    </Row>
                </Col>
            </Row>
            <div
                onClick={handleContextMenuClick}
                className='cvat-job-item-more-button cvat-actions-menu-button'
            >
                <MoreOutlined className='cvat-menu-icon' />
            </div>
        </Card>
    );

    return (
        <Col span={24}>
            <JobActionsComponent
                jobInstance={job}
                dropdownTrigger={['contextMenu']}
                triggerElement={card}
                onApplyFilter={onApplyFilter}
            />
        </Col>
    );
}

export default React.memo(JobItem);
