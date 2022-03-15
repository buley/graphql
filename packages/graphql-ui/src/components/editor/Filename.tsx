import { useContext } from "react";
import { ThemeContext, Theme } from "../../contexts/theme";
// @ts-ignore
import GraphQLIcon from "../../assets/graphql-icon.svg";

export enum Extension {
    JSON,
    GQL,
}

export interface Props {
    name: string;
    extension: Extension;
}

const Icon = (props: { extension: Extension }) => {
    switch (props.extension) {
        case Extension.GQL:
            return <span>{<img src={GraphQLIcon} alt="graphql-logo" className="inline w-1/12 h-1/12" />}</span>;
        case Extension.JSON:
            return <span className="text-yellow-500 w-1/12 h-1/12">{"{ }"}</span>;
    }
};

const Ending = (props: { extension: Extension }) => {
    let content = "";
    switch (props.extension) {
        case Extension.GQL:
            content = ".gql";
            break;
        case Extension.JSON:
            content = ".json";
            break;
    }

    return <span>{content}</span>;
};

export const FileName = (props: Props) => {
    const theme = useContext(ThemeContext);

    return (
        <div
            className={`m-0 p-1 pl-2 ${
                theme.editorTheme === Theme.LIGHT ? "bg-white" : "bg-draculaDark"
            } w-48 rounded-t`}
        >
            <p className={`${theme.editorTheme === Theme.LIGHT ? "text-black" : "text-white"} text-sm`}>
                <Icon extension={props.extension}></Icon> <span className="pl-1">{props.name}</span>
                <Ending extension={props.extension}></Ending>
            </p>
        </div>
    );
};
