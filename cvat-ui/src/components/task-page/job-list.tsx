// Copyright (C) 2020-2022 Intel Corporation
// Copyright (C) CVAT.ai Corporation
//
// SPDX-License-Identifier: MIT

import React, { useCallback, useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import jsonLogic from 'json-logic-js';
import _ from 'lodash';
import { CombinedState, JobsQuery, SelectedResourceType } from 'reducers';
import { useHistory } from 'react-router';
import { Row, Col } from 'antd/lib/grid';
import Text from 'antd/lib/typography/Text';
import Pagination from 'antd/lib/pagination';
import Empty from 'antd/lib/empty';
import notification from 'antd/lib/notification';
import Button from 'antd/lib/button';
import copy from 'copy-to-clipboard';
import { PlusOutlined, CopyOutlined } from '@ant-design/icons';
import { Task, Job, getCore, JobStage } from 'cvat-core-wrapper';
import CVATTooltip from 'components/common/cvat-tooltip';
import JobItem, { JobData } from 'components/job-item/job-item';
import {
    SortingComponent, ResourceFilterHOC, defaultVisibility, updateHistoryFromQuery, ResourceSelectionInfo,
} from 'components/resource-sorting-filtering';
import { useResourceQuery } from 'utils/hooks';
import BulkWrapper from 'components/bulk-wrapper';
import { selectionActions } from 'actions/selection-actions';
import JobsCSVExportButton from 'components/jobs-page/jobs-csv-export-button';
import {
    localStorageRecentKeyword, localStorageRecentCapacity, predefinedFilterValues, config,
} from './jobs-filter-configuration';

const FilteringComponent = ResourceFilterHOC(
    config, localStorageRecentKeyword, localStorageRecentCapacity, predefinedFilterValues,
);

interface Props {
    task: Task;
    onJobUpdate(job: Job, data: Parameters<Job['save']>[0]): Promise<void>;
    onRefreshUI(): void;
}

function filterJobs(jobs: Job[], query: JobsQuery): Job[] {
    let result = jobs;

    if (query.sort) {
        let sort = query.sort.split(',');
        const orders = sort.map((elem: string) => (elem.startsWith('-') ? 'desc' : 'asc'));
        sort = sort.map((elem: string) => (elem.startsWith('-') ? elem.substring(1) : elem));
        const assigneeInd = sort.indexOf('assignee');
        if (assigneeInd > -1) {
            sort[assigneeInd] = 'assignee.username';
        }
        result = _.orderBy(result, sort, orders);
    }
    if (query.filter) {
        const converted = result.map((job) => ({
            assignee: job.assignee ? job.assignee.username : null,
            stage: job.stage,
            state: job.state,
            dimension: job.dimension,
            updatedDate: job.updatedDate,
            type: job.type,
            id: job.id,
            parent_job_id: job.parentJobId,
        }));
        const filter = JSON.parse(query.filter);
        result = result.filter((job, index) => jsonLogic.apply(filter, converted[index]));
    }

    return result;
}

function setUpJobsList(jobs: Job[], newPage: number, pageSize: number): Job[] {
    return jobs.slice((newPage - 1) * pageSize, newPage * pageSize);
}

function JobListComponent(props: Readonly<Props>): JSX.Element {
    const { task: taskInstance, onJobUpdate, onRefreshUI } = props;
    const [visibility, setVisibility] = useState(defaultVisibility);

    const history = useHistory();
    const { id: taskId } = taskInstance;
    const { jobs } = taskInstance;

    const defaultQuery: JobsQuery = {
        page: 1,
        pageSize: 10,
        sort: null,
        search: null,
        filter: '{"and":[{"!":{"var":"parent_job_id"}}]}',
    };
    const query = useResourceQuery<JobsQuery>(defaultQuery, defaultQuery);

    const [jobChildMapping, setJobChildMapping] = useState<Record<number, Job[]>>({});
    useEffect(() => {
        if (taskInstance.consensusEnabled) {
            const mapping = jobs.reduce((acc, job) => {
                if (job.parentJobId === null && !acc[job.id]) {
                    acc[job.id] = [];
                } else if (job.parentJobId !== null) {
                    if (!acc[job.parentJobId]) {
                        acc[job.parentJobId] = [];
                    }
                    acc[job.parentJobId].push(job);
                }
                return acc;
            }, {} as Record<number, Job[]>);
            setJobChildMapping(mapping);
        }
    }, [taskInstance]);

    const jobChildIdMapping = Object.keys(jobChildMapping).reduce((acc, jobId) => {
        const childIds = jobChildMapping[Number(jobId)].map((job) => job.id);
        acc[Number(jobId)] = childIds;
        return acc;
    }, {} as Record<number, number[]>);

    const [uncollapsedJobs, setUncollapsedJobs] = useState<Record<number, boolean>>({});
    useEffect(() => {
        const savedState = localStorage.getItem('uncollapsedJobs');
        if (savedState) {
            setUncollapsedJobs(JSON.parse(savedState));
        }
    }, []);
    const onCollapseChange = useCallback((jobId: number) => {
        setUncollapsedJobs((prevState) => {
            const newState = { ...prevState };
            newState[jobId] = !prevState[jobId];

            localStorage.setItem('uncollapsedJobs', JSON.stringify(newState));
            return newState;
        });
    }, []);

    const [jobDataArray, setJobDataArray] = useState<JobData[]>([]);

    const addObject = useCallback((newData: JobData) => {
        setJobDataArray((prevData) => [...prevData, newData]);
    }, []);

    const renewAllJobs = useCallback(async (): Promise<void> => {
        const core = getCore();
        const updateData = { state: core.enums.JobState.NEW, stage: JobStage.ANNOTATION };
        const promises = taskInstance.jobs.map((job: Job) => {
            if (job.state !== core.enums.JobState.NEW || job.stage !== JobStage.ANNOTATION) {
                return onJobUpdate(job, updateData);
            }
            return Promise.resolve();
        });

        try {
            await Promise.all(promises);
            onRefreshUI();
        } catch (error: unknown) {
            notification.error({
                message: 'Failed to renew all jobs',
                description: String(error),
            });
        }
    }, [taskInstance, onJobUpdate, onRefreshUI]);

    const filteredJobs = filterJobs(jobs, query);
    const jobIds = filteredJobs.map((job) => job.id);
    const viewedJobs = setUpJobsList(filteredJobs, query.page, query.pageSize);

    const setQuery = useCallback((nextQuery: JobsQuery) => {
        const nextSearch = updateHistoryFromQuery(nextQuery);

        if (nextSearch === (history.location.search || '')) return;

        if (query.filter === nextQuery.filter && query.sort === nextQuery.sort) {
            history.replace({ search: nextSearch });
        } else {
            history.push({ ...history.location, search: nextSearch });
        }
    }, [history.location, query]);

    const onCreateJob = useCallback(() => {
        history.push(`/tasks/${taskId}/jobs/create`);
    }, []);

    const dispatch = useDispatch();
    const selectedCount = useSelector((state: CombinedState) => state.jobs.selected.length);
    const onSelectAll = useCallback(() => {
        const allJobIds = viewedJobs.flatMap((job) => [
            job.id,
        ]);
        dispatch(selectionActions.selectResources(allJobIds, SelectedResourceType.JOBS));
    }, [dispatch, filteredJobs]);

    const onApplyFilter = useCallback((filter: string | null) => {
        setQuery({
            ...query,
            filter: filter || '{}',
        });
    }, [query]);

    return (
        <>
            <div className='cvat-jobs-list-filters-wrapper'>
                <Row>
                    <Col>
                        <Text className='cvat-text-color cvat-jobs-header'> Jobs </Text>
                        <ResourceSelectionInfo selectedCount={selectedCount} onSelectAll={onSelectAll} />
                    </Col>
                    <Col>
                        <CVATTooltip trigger='click' title='Copied to clipboard!'>
                            <Button
                                className='cvat-copy-job-details-button'
                                type='link'
                                onClick={(): void => {
                                    let serialized = '';
                                    const [latestJob] = [...taskInstance.jobs].reverse();
                                    for (const job of taskInstance.jobs) {
                                        const baseURL = window.location.origin;
                                        serialized += `Job #${job.id}`.padEnd(`${latestJob.id}`.length + 6, ' ');
                                        serialized += `: ${baseURL}/tasks/${taskInstance.id}/jobs/${job.id}`.padEnd(
                                            `${latestJob.id}`.length + baseURL.length + 8,
                                            ' ',
                                        );
                                        serialized += `: [${job.startFrame}-${job.stopFrame}]`.padEnd(
                                            `${latestJob.startFrame}${latestJob.stopFrame}`.length + 5,
                                            ' ',
                                        );

                                        if (job.assignee) {
                                            serialized += `\t assigned to "${job.assignee.username}"`;
                                        }

                                        serialized += '\n';
                                    }
                                    copy(serialized);
                                }}
                            >
                                <CopyOutlined />
                                Copy
                            </Button>
                        </CVATTooltip>
                    </Col>
                    <Col>
                        <CVATTooltip trigger='click' title='Copied to clipboard!'>
                            <Button
                                className='cvat-copy-job-details-button'
                                type='link'
                                onClick={(): void => {
                                    let header1 = 'Job ID,URL,Frame Range,Assignee,Objects,Attributes';
                                    let header2 = ',,,,,';
                                    const [latestJob] = [...taskInstance.jobs].reverse();

                                    const assigneeTotals: { [key: string]: number[] } = {};

                                    if (latestJob) {
                                        const latestJobData = jobDataArray.find(
                                            (data: JobData) => data.jobId === latestJob.id,
                                        );
                                        if (latestJobData) {
                                            for (const label in latestJobData.attributesPerLabel) {
                                                if (Object.prototype.hasOwnProperty.call(
                                                    latestJobData.attributesPerLabel, label,
                                                )) {
                                                    const labelName = latestJobData.attributesPerLabel[label]
                                                        .label_name;
                                                    header1 += `,${labelName},,`;
                                                    header2 += ',Obj,Attr,Attr+';

                                                    for (const attrKey in latestJobData.attributesPerLabel[label]
                                                        .true_attributes_sums) {
                                                        if (Object.prototype.hasOwnProperty.call(
                                                            latestJobData.attributesPerLabel[label]
                                                                .true_attributes_sums, attrKey,
                                                        )) {
                                                            const attrName = latestJobData.attributesPerLabel[label]
                                                                .true_attributes_sums[attrKey].name;
                                                            header2 += `,${attrName}`;
                                                            header1 += ',';
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    }

                                    let serialized = `${header1}\n${header2}\n`;
                                    const totalJobs = new Array(header2.split(',').length - 4).fill(0);

                                    for (const job of taskInstance.jobs) {
                                        const baseURL = window.location.origin;
                                        const jobID = `Job #${job.id}`;
                                        const url = `${baseURL}/tasks/${taskInstance.id}/jobs/${job.id}`;
                                        const frameRange = `[${job.startFrame}-${job.stopFrame}]`;
                                        const assignee = job.assignee ? `"${job.assignee.username}"` : 'none';

                                        const jobData = jobDataArray.find((data: JobData) => data.jobId === job.id);
                                        const objectsCount = jobData ? jobData.objectsCount : 0;
                                        const attributesCount = jobData ? jobData.attributesCount : 0;

                                        let jobDataStr = `${jobID},${url},${frameRange},${assignee},` +
                                            `${objectsCount},${attributesCount}`;

                                        if (!assigneeTotals[assignee]) {
                                            assigneeTotals[assignee] = new Array(
                                                header2.split(',').length - 4,
                                            ).fill(0);
                                        }
                                        assigneeTotals[assignee][0] += objectsCount;
                                        assigneeTotals[assignee][1] += attributesCount;

                                        if (jobData) {
                                            let i = 2;
                                            for (const label in jobData.attributesPerLabel) {
                                                if (Object.prototype.hasOwnProperty.call(
                                                    jobData.attributesPerLabel, label,
                                                )) {
                                                    const labelData = jobData.attributesPerLabel[label];
                                                    jobDataStr += `,${labelData.objects},${labelData.attributes},` +
                                                        `${labelData.true_attributes}`;
                                                    assigneeTotals[assignee][i] += labelData.objects;
                                                    assigneeTotals[assignee][i + 1] += labelData.attributes;
                                                    assigneeTotals[assignee][i + 2] += labelData.true_attributes;

                                                    let attributeIndex = i + 3;
                                                    for (const attrKey in labelData.true_attributes_sums) {
                                                        if (Object.prototype.hasOwnProperty.call(
                                                            labelData.true_attributes_sums, attrKey,
                                                        )) {
                                                            const attrCount = labelData.true_attributes_sums[attrKey]
                                                                .count;
                                                            jobDataStr += `,${attrCount}`;
                                                            if (assigneeTotals[assignee][attributeIndex] === undefined) {
                                                                assigneeTotals[assignee][attributeIndex] = 0;
                                                            }
                                                            assigneeTotals[assignee][attributeIndex] += attrCount;
                                                            attributeIndex += 1;
                                                        }
                                                    }
                                                    i = attributeIndex;
                                                }
                                            }
                                        }

                                        serialized += `${jobDataStr}\n`;
                                    }

                                    for (const assignee in assigneeTotals) {
                                        if (Object.prototype.hasOwnProperty.call(assigneeTotals, assignee)) {
                                            const totalRow = [, , , assignee]
                                                .concat(assigneeTotals[assignee].map(String)).join(',');
                                            serialized += `${totalRow}\n`;
                                        }
                                    }

                                    for (const assignee in assigneeTotals) {
                                        if (Object.prototype.hasOwnProperty.call(assigneeTotals, assignee)) {
                                            for (let j = 0; j < assigneeTotals[assignee].length; j++) {
                                                totalJobs[j] = (totalJobs[j] || 0) +
                                                    (assigneeTotals[assignee][j] || 0);
                                            }
                                        }
                                    }

                                    const totalJobsRow = [, , , 'All Jobs']
                                        .concat(totalJobs.map(String)).join(',');
                                    serialized += `${totalJobsRow}\n`;

                                    copy(serialized);
                                }}
                            >
                                <CopyOutlined />
                                Info
                            </Button>
                        </CVATTooltip>
                    </Col>
                    <Col>
                        <CVATTooltip trigger='click' title='All Jobs to annotation/new!'>
                            <Button
                                className='cvat-copy-job-stage-button'
                                type='link'
                                onClick={renewAllJobs}
                            >
                                <CopyOutlined />
                                Renew All Jobs
                            </Button>
                        </CVATTooltip>
                    </Col>
                </Row>
                <Row>
                    <SortingComponent
                        visible={visibility.sorting}
                        onVisibleChange={(visible: boolean) => (
                            setVisibility({ ...defaultVisibility, sorting: visible })
                        )}
                        defaultFields={query.sort?.split(',') || ['-ID']}
                        sortingFields={['ID', 'Assignee', 'State', 'Stage']}
                        onApplySorting={(sort: string | null) => {
                            setQuery({
                                ...query,
                                sort,
                            });
                        }}
                    />
                    <FilteringComponent
                        value={query.filter}
                        predefinedVisible={visibility.predefined}
                        builderVisible={visibility.builder}
                        recentVisible={visibility.recent}
                        onPredefinedVisibleChange={(visible: boolean) => (
                            setVisibility({ ...defaultVisibility, predefined: visible })
                        )}
                        onBuilderVisibleChange={(visible: boolean) => (
                            setVisibility({ ...defaultVisibility, builder: visible })
                        )}
                        onRecentVisibleChange={(visible: boolean) => (
                            setVisibility({ ...defaultVisibility, builder: visibility.builder, recent: visible })
                        )}
                        onApplyFilter={onApplyFilter}
                    />
                    <JobsCSVExportButton predefinedData={filteredJobs} />
                    <div className='cvat-job-add-wrapper'>
                        <Button onClick={onCreateJob} type='primary' className='cvat-create-job' icon={<PlusOutlined />} />
                    </div>
                </Row>
            </div>
            {jobIds.length ? (
                <div className='cvat-task-job-list'>
                    <Col className='cvat-jobs-list'>
                        <BulkWrapper
                            currentResourceIds={jobIds}
                            resourceType={SelectedResourceType.JOBS}
                        >
                            {(selectProps) => (
                                viewedJobs
                                    .map((job: Job, idx: number) => {
                                        const { selected, onClick } = selectProps(job.id, idx);
                                        return (
                                            <JobItem
                                                key={job.id}
                                                job={job}
                                                task={taskInstance}
                                                onJobUpdate={onJobUpdate}
                                                selected={selected}
                                                onClick={onClick}
                                                jobDataArray={jobDataArray}
                                                addObject={addObject}
                                                onApplyFilter={onApplyFilter}
                                            />
                                        );
                                    })
                            )}
                        </BulkWrapper>
                    </Col>
                </div>
            ) : (
                <Empty description='No jobs found' />
            )}
            <Row justify='center' align='middle'>
                <Col>
                    <Pagination
                        className='cvat-tasks-pagination'
                        onChange={(page: number, pageSize: number) => {
                            setQuery({
                                ...query,
                                page,
                                pageSize,
                            });
                        }}
                        total={filteredJobs.length}
                        pageSize={query.pageSize}
                        current={query.page}
                        showQuickJumper
                        showSizeChanger
                    />
                </Col>
            </Row>
        </>
    );
}

export default React.memo(JobListComponent);
